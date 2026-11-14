import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { $ } from "bun";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MODE_EXEC, MODE_FILE, MODE_SYMLINK } from "../skill/files.ts";
import {
  cloneOrFetch,
  defaultBranch,
  diffSubtree,
  ensureClone,
  findRef,
  git,
  gitReason,
  commitTime,
  headCommit,
  isBranch,
  listTags,
  lsTreeEntries,
  pathHistory,
  resolveRef,
  readBlobs,
  splitDiff,
  sshAlternate,
  subtreeOid,
} from "./git.ts";
import { captureEnv } from "../../test-env.ts";

let template: string;
let tmp: string;
let remote: string;
let work: string;
let firstSha: string;
const restoreEnv = captureEnv(
  "XDG_CACHE_HOME",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_NOSYSTEM",
);

const commit = async (message: string): Promise<string> => {
  await $`git -C ${work} add -A`.quiet();
  await $`git -C ${work} -c commit.gpgsign=false -c user.email=test@example.com -c user.name=Test commit -q -m ${message}`.quiet();
  return (await $`git -C ${work} rev-parse HEAD`.text()).trim();
};

const addSecondCommit = async (): Promise<string> => {
  await writeFile(join(work, "skills", "demo", "SKILL.md"), "second\n");
  await writeFile(join(work, "skills", "demo", "notes.txt"), "new\n");
  const sha = await commit("second");
  await $`git -C ${work} push -q origin main`.quiet();
  return sha;
};

const useGitConfig = async (dir: string): Promise<void> => {
  process.env.GIT_CONFIG_GLOBAL = join(dir, "empty-gitconfig");
  await writeFile(process.env.GIT_CONFIG_GLOBAL, "");
};

// Building the fixture costs a dozen git calls, so build it once and copy it into each test.
beforeAll(async () => {
  template = await mkdtemp(join(tmpdir(), "niksi-git-template-"));
  process.env.GIT_CONFIG_COUNT = "0";
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  await useGitConfig(template);
  remote = join(template, "remote.git");
  work = join(template, "work");

  await $`git init -q --bare --object-format=sha1 --initial-branch=main ${remote}`.quiet();
  await $`git init -q --object-format=sha1 --initial-branch=main ${work}`.quiet();
  await mkdir(join(work, "skills", "demo"), { recursive: true });
  await writeFile(join(work, "README.md"), "fixture\n");
  await writeFile(join(work, "run.sh"), "#!/bin/sh\necho fixture\n");
  await chmod(join(work, "run.sh"), 0o755);
  await writeFile(join(work, "skills", "demo", "SKILL.md"), "first\n");
  await symlink("README.md", join(work, "readme-link"));
  firstSha = await commit("first");
  await $`git -C ${work} remote add origin ../remote.git`.quiet();
  await $`git -C ${work} push -q -u origin main`.quiet();
  await $`git -C ${work} branch topic`.quiet();
  await $`git -C ${work} push -q origin topic`.quiet();
  await $`git -C ${work} -c tag.gpgsign=false -c user.email=test@example.com -c user.name=Test tag -a v1.0.0 -m release`.quiet();
  await $`git -C ${work} tag preview`.quiet();
  await $`git -C ${work} push -q origin --tags`.quiet();
}, 30_000);

afterAll(async () => {
  restoreEnv();
  await rm(template, { recursive: true, force: true });
});

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "niksi-git-test-"));
  await cp(template, tmp, { recursive: true, verbatimSymlinks: true });
  process.env.XDG_CACHE_HOME = join(tmp, "cache");
  await useGitConfig(tmp);
  remote = join(tmp, "remote.git");
  work = join(tmp, "work");
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
}, 30_000);

test("git captures stdout, binary output, and failures", async () => {
  const text = await git(["show", "HEAD:README.md"], work);
  expect(text).toMatchObject({ code: 0, out: "fixture", err: "" });
  expect(text.buf).toEqual(Buffer.from("fixture\n"));

  const failure = await git(["rev-parse", "missing"], work);
  expect(failure.code).not.toBe(0);
  expect(failure.err).toContain("unknown revision");
});

test("ensureClone fetches a source once per run and shares the clone with every caller", async () => {
  const first = ensureClone(remote);
  expect(ensureClone(remote)).toBe(first);
  const clone = await first;
  expect(clone).toStartWith(join(process.env.XDG_CACHE_HOME!, "niksi", "repos"));
  expect(await headCommit(clone, "main")).toBe(firstSha);

  await addSecondCommit();
  expect(await ensureClone(remote)).toBe(clone);
  expect(await headCommit(clone, "main")).toBe(firstSha);
});

test("cloneOrFetch brings later changes into the cached clone", async () => {
  const clone = await cloneOrFetch(remote);
  const secondSha = await addSecondCommit();
  expect(await cloneOrFetch(remote)).toBe(clone);
  expect(await headCommit(clone, "main")).toBe(secondSha);
});

test("a failed fetch replaces the cached clone from the source repository", async () => {
  const clone = await cloneOrFetch(remote);
  await git(["remote", "set-url", "origin", join(tmp, "missing.git")], clone);

  expect(await cloneOrFetch(remote)).toBe(clone);
  expect(await headCommit(clone, "main")).toBe(firstSha);
  expect((await git(["remote", "get-url", "origin"], clone)).out).toBe(remote);
});

test("a failed replacement preserves the last cached clone and permits a retry", async () => {
  const clone = await cloneOrFetch(remote);
  await git(["remote", "set-url", "origin", join(tmp, "missing.git")], clone);
  const unavailable = `${remote}.unavailable`;
  await rename(remote, unavailable);

  await expect(cloneOrFetch(remote)).rejects.toThrow(`cannot reach ${remote}`);
  expect(await headCommit(clone, "main")).toBe(firstSha);

  await rename(unavailable, remote);
  expect(await cloneOrFetch(remote)).toBe(clone);
});

const lookalikeSources = async (): Promise<{
  trusted: string;
  lookalike: string;
  lookalikeSha: string;
}> => {
  const trusted = join(tmp, "src", "acme", "tools-skills");
  const lookalike = join(tmp, "src", "acme", "tools", "skills");
  await cp(remote, trusted, { recursive: true });
  await cp(remote, lookalike, { recursive: true });
  await writeFile(join(work, "skills", "demo", "SKILL.md"), "lookalike\n");
  const lookalikeSha = await commit("lookalike");
  await $`git -C ${work} push -q ${lookalike} main`.quiet();
  return { trusted, lookalike, lookalikeSha };
};

test("sources whose names differ only in punctuation get separate clones", async () => {
  const { trusted, lookalike, lookalikeSha } = await lookalikeSources();

  const lookalikeClone = await cloneOrFetch(lookalike);
  const trustedClone = await cloneOrFetch(trusted);

  expect(trustedClone).not.toBe(lookalikeClone);
  expect(await headCommit(trustedClone, "main")).toBe(firstSha);
  expect(await headCommit(lookalikeClone, "main")).toBe(lookalikeSha);
  expect((await git(["remote", "get-url", "origin"], trustedClone)).out).toBe(trusted);
});

test("a clone at the punctuation-folded name of a source is never reused", async () => {
  const { trusted, lookalike } = await lookalikeSources();
  const repos = join(process.env.XDG_CACHE_HOME!, "niksi", "repos");
  const folded = join(repos, trusted.replace(/[^a-zA-Z0-9]/gu, "_"));
  await mkdir(repos, { recursive: true });
  await $`git clone -q --no-checkout -- ${lookalike} ${folded}`.quiet();

  const clone = await cloneOrFetch(trusted);

  expect(clone).not.toBe(folded);
  expect(await headCommit(clone, "main")).toBe(firstSha);
});

test("a rejected initial clone can be retried after the repository appears", async () => {
  const lateRemote = join(tmp, "late.git");
  await expect(ensureClone(lateRemote)).rejects.toThrow(`cannot reach ${lateRemote}`);
  await $`git init -q --bare --object-format=sha1 --initial-branch=main ${lateRemote}`.quiet();
  expect(await ensureClone(lateRemote)).toStartWith(
    join(process.env.XDG_CACHE_HOME!, "niksi", "repos"),
  );
});

test("tree operations preserve paths, modes, contents, and subtree identity", async () => {
  const clone = await ensureClone(remote);
  const entries = await lsTreeEntries(clone, firstSha, "");
  expect(entries.map(({ mode, path }) => ({ mode, path }))).toEqual([
    { mode: MODE_FILE, path: "README.md" },
    { mode: MODE_SYMLINK, path: "readme-link" },
    { mode: MODE_EXEC, path: "run.sh" },
    { mode: MODE_FILE, path: "skills/demo/SKILL.md" },
  ]);
  expect(entries.every((entry) => /^[0-9a-f]{40}$/u.test(entry.oid))).toBeTrue();
  const skillMd = entries.find((entry) => entry.path === "skills/demo/SKILL.md")!;
  expect(await readBlobs(clone, [skillMd.oid])).toEqual([Buffer.from("first\n")]);
  expect(await subtreeOid(clone, firstSha, "skills/demo")).toMatch(/^[0-9a-f]{40}$/u);
  expect(await subtreeOid(clone, firstSha, "missing")).toBeNull();
});

test("readBlobs rejects an object the remote cannot supply", async () => {
  const clone = await ensureClone(remote);
  const absent = "0".repeat(40);
  await expect(readBlobs(clone, [absent])).rejects.toThrow("cannot fetch blobs");
});

test("readBlobs returns one buffer per oid, in the order asked, including repeats", async () => {
  const clone = await ensureClone(remote);
  const entries = await lsTreeEntries(clone, firstSha, "");
  const readme = entries.find((entry) => entry.path === "README.md")!.oid;
  const skill = entries.find((entry) => entry.path === "skills/demo/SKILL.md")!.oid;
  expect(await readBlobs(clone, [skill, readme, skill])).toEqual([
    Buffer.from("first\n"),
    Buffer.from("fixture\n"),
    Buffer.from("first\n"),
  ]);
  expect(await readBlobs(clone, [])).toEqual([]);
});

test("refs resolve branches, lightweight tags, annotated tags, and commits", async () => {
  const clone = await ensureClone(remote);
  expect(await findRef(clone, "main")).toBe(firstSha);
  expect(await findRef(clone, "preview")).toBe(firstSha);
  expect(await findRef(clone, "v1.0.0")).toBe(firstSha);
  expect(await findRef(clone, firstSha)).toBe(firstSha);
  expect(await findRef(clone, "missing")).toBeNull();
  expect(await resolveRef(clone, "topic")).toBe(firstSha);
  expect(resolveRef(clone, "missing")).rejects.toThrow('ref "missing" not found upstream');
  expect(await isBranch(clone, "topic")).toBe(true);
  expect(await isBranch(clone, "preview")).toBe(false);
  expect(await listTags(clone)).toEqual([
    { name: "preview", commit: firstSha },
    { name: "v1.0.0", commit: firstSha },
  ]);
});

test("defaultBranch falls back to ls-remote when origin/HEAD is absent", async () => {
  const clone = await ensureClone(remote);
  await git(["symbolic-ref", "--delete", "refs/remotes/origin/HEAD"], clone);
  expect(await defaultBranch(clone)).toBe("main");
});

test("defaultBranch reports an ls-remote failure", async () => {
  const clone = await ensureClone(remote);
  await git(["symbolic-ref", "--delete", "refs/remotes/origin/HEAD"], clone);
  await git(["remote", "set-url", "origin", join(tmp, "missing.git")], clone);
  expect(defaultBranch(clone)).rejects.toThrow("cannot determine the default branch");
});

test("diff operations report fixture changes at the repo and subtree levels", async () => {
  const clone = await ensureClone(remote);
  const secondSha = await addSecondCommit();
  await cloneOrFetch(remote);
  const diff = await diffSubtree(clone, firstSha, secondSha, "skills/demo");
  expect(diff).toContain("-first");
  expect(diff).toContain("+second");
  expect(diff).toContain("notes.txt");
});

test("splitDiff separates the stat from the patch at the first diff header", () => {
  const stat = " SKILL.md | 2 +-\n 1 file changed, 1 insertion(+), 1 deletion(-)";
  const patch = "diff --git a/SKILL.md b/SKILL.md\n@@ -1 +1 @@\n-first\n+second\n";
  expect(splitDiff(`${stat}\n\n${patch}`)).toEqual({ stat, patch });
});

test("splitDiff keeps text without a diff header as the stat", () => {
  expect(splitDiff("(installed content is missing; showing no diff)")).toEqual({
    stat: "(installed content is missing; showing no diff)",
    patch: "",
  });
  expect(splitDiff("")).toEqual({ stat: "", patch: "" });
});

test("missing branches and invalid trees use the documented failure values", async () => {
  const clone = await ensureClone(remote);
  expect(headCommit(clone, "missing")).rejects.toThrow("branch missing not found upstream");
  expect(await lsTreeEntries(clone, "missing", "")).toEqual([]);
  expect(await diffSubtree(clone, "missing", firstSha, "")).toBe("");
});

test("pathHistory lists each content of a path and reports a start that does not exist", async () => {
  const second = await addSecondCommit();
  const clone = await ensureClone(remote);
  const demo = "skills/demo";
  expect(
    (await pathHistory(clone, [firstSha, "origin/main"], demo, 10)).map((past) => past.commit),
  ).toEqual([firstSha, second]);
  await expect(pathHistory(clone, [firstSha, "origin/missing"], demo, 10)).rejects.toThrow(
    "cannot read the history of skills/demo",
  );
});

test("lsTreeEntries rejects a path that is not valid UTF-8", async () => {
  const clone = await ensureClone(remote);
  const blob = (
    await $`git -C ${clone} hash-object -w --stdin < ${Buffer.from("x\n")}`.text()
  ).trim();
  const records = ["a\xff", "a\xfe"].map((name) =>
    Buffer.concat([
      Buffer.from(`100644 blob ${blob}\t`),
      Buffer.from(name, "latin1"),
      Buffer.of(0),
    ]),
  );
  const tree = (await $`git -C ${clone} mktree -z < ${Buffer.concat(records)}`.text()).trim();
  await expect(lsTreeEntries(clone, tree, "")).rejects.toThrow(
    `a path at ${tree} is not valid UTF-8`,
  );
});

test("commitTime reads the committer date, and rejects a commit the clone lacks", async () => {
  const clone = await ensureClone(remote);
  const dated = (
    await $`git -C ${clone} -c user.email=test@example.com -c user.name=Test commit-tree ${firstSha}^{tree} -m dated`
      .env({ ...process.env, GIT_COMMITTER_DATE: "@1700000000 +0000" })
      .text()
  ).trim();
  expect(await commitTime(clone, dated)).toBe(1_700_000_000);
  expect(commitTime(clone, "f".repeat(40))).rejects.toThrow(`cannot read the date of ffffffff`);
});

test("commitTime reads a signed commit's date when log.showSignature is on", async () => {
  const clone = await ensureClone(remote);
  const key = join(tmp, "signing-key");
  const signers = join(tmp, "allowed-signers");
  await $`ssh-keygen -q -t ed25519 -N ${""} -C test -f ${key}`.quiet();
  await writeFile(signers, `test@example.com ${await Bun.file(`${key}.pub`).text()}`);
  await writeFile(
    process.env.GIT_CONFIG_GLOBAL!,
    `[log]\n\tshowSignature = true\n[gpg]\n\tformat = ssh\n[gpg "ssh"]\n\tallowedSignersFile = ${signers}\n`,
  );
  const signed = (
    await $`git -C ${clone} -c user.email=test@example.com -c user.name=Test -c user.signingkey=${key}.pub commit-tree -S ${firstSha}^{tree} -m signed`
      .env({ ...process.env, GIT_COMMITTER_DATE: "@1700000000 +0000" })
      .text()
  ).trim();
  expect(await commitTime(clone, signed)).toBe(1_700_000_000);
});

// Git's --output writes a file, so any probe file shows that a value was read as an option.
const optionProbe = (): string => `--output=${join(tmp, "probe")}`;
const probeFiles = async (): Promise<string[]> =>
  (await readdir(tmp)).filter((name) => name.startsWith("probe"));

test("subtreeOid reads a dash-prefixed revision as a revision", async () => {
  const clone = await ensureClone(remote);
  expect(await subtreeOid(clone, optionProbe(), "skills/demo")).toBeNull();
  expect(await subtreeOid(clone, optionProbe(), "")).toBeNull();
  expect(await probeFiles()).toEqual([]);
});

test("commitTime reads a dash-prefixed revision as a revision", async () => {
  const clone = await ensureClone(remote);
  expect(commitTime(clone, optionProbe())).rejects.toThrow("cannot read the date");
  expect(await probeFiles()).toEqual([]);
});

test("lsTreeEntries reads a dash-prefixed revision as a revision", async () => {
  const clone = await ensureClone(remote);
  expect(await lsTreeEntries(clone, optionProbe(), "skills/demo")).toEqual([]);
  expect(await probeFiles()).toEqual([]);
});

test("diffSubtree reads dash-prefixed revisions as revisions", async () => {
  const clone = await ensureClone(remote);
  expect(await diffSubtree(clone, optionProbe(), firstSha, "skills/demo")).toBe("");
  expect(await diffSubtree(clone, firstSha, optionProbe(), "")).toBe("");
  expect(await probeFiles()).toEqual([]);
});

test("findRef reads a dash-prefixed ref as a ref", async () => {
  const clone = await ensureClone(remote);
  expect(await findRef(clone, optionProbe())).toBeNull();
  expect(await probeFiles()).toEqual([]);
});

test("cloneOrFetch reads a dash-prefixed source as the repository", async () => {
  const repo = `--upload-pack=touch ${join(tmp, "probe")}`;
  await expect(cloneOrFetch(repo)).rejects.toThrow(`cannot reach ${repo} (not a Git repository)`);
  expect(await probeFiles()).toEqual([]);
});

test("an https address maps to the scp-style ssh address of the same repository", () => {
  expect(sshAlternate("https://github.com/owner/repo")).toBe("git@github.com:owner/repo");
  expect(sshAlternate("https://gitlab.com/group/sub/repo.git")).toBe(
    "git@gitlab.com:group/sub/repo.git",
  );
  expect(sshAlternate("https://github.com/owner/repo/")).toBe("git@github.com:owner/repo");
  expect(sshAlternate("git@github.com:owner/repo")).toBeNull();
  expect(sshAlternate(`file://${remote}`)).toBeNull();
  expect(sshAlternate("https://token@github.com/owner/repo")).toBeNull();
  expect(sshAlternate("https://github.com:8443/owner/repo")).toBeNull();
  expect(sshAlternate("https://github.com/")).toBeNull();
});

test("an unreachable https clone falls back to the ssh address", async () => {
  await writeFile(
    process.env.GIT_CONFIG_GLOBAL!,
    `[url "${remote}"]\n\tinsteadOf = git@niksi-test.invalid:demo\n`,
  );
  const clone = await cloneOrFetch("https://niksi-test.invalid/demo");
  expect(await headCommit(clone, "main")).toBe(firstSha);
}, 30_000);

// An ssh that records its arguments, then runs the remote command on this machine.
const fakeSsh = async (): Promise<{ log: string; ssh: string }> => {
  const log = join(tmp, "ssh.log");
  const ssh = join(tmp, "bin", "ssh");
  await mkdir(join(tmp, "bin"));
  await writeFile(
    ssh,
    `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nfor last; do :; done\nexec sh -c "$last"\n`,
  );
  await chmod(ssh, 0o755);
  await $`git -C ${remote} config uploadpack.allowFilter true`.quiet();
  return { log, ssh };
};

const sshCalls = async (log: string): Promise<string[]> =>
  (await readFile(log, "utf8").catch(() => "")).split("\n").filter(Boolean);

test("an sshBatch clone runs every ssh call in batch mode over the user's BatchMode and keeps the user's other ssh options", async () => {
  const restore = captureEnv("GIT_SSH_COMMAND");
  const { log, ssh } = await fakeSsh();
  process.env.GIT_SSH_COMMAND = `'${ssh}' -o User=me -o BatchMode=no`;
  try {
    const repo = `ssh://niksi-test.invalid${remote}`;
    const clone = await ensureClone(repo, { sshBatch: true });
    expect(await cloneOrFetch(repo, { sshBatch: true })).toBe(clone);
    const entries = await lsTreeEntries(clone, firstSha, "skills/demo");
    expect(await readBlobs(clone, [entries[0]!.oid])).toEqual([Buffer.from("first\n")]);

    const calls = await sshCalls(log);
    expect(calls.length).toBeGreaterThanOrEqual(3);
    // ssh keeps the first value of an option, so BatchMode=yes must come first.
    for (const call of calls)
      expect(call).toStartWith("-o BatchMode=yes -o User=me -o BatchMode=no ");
  } finally {
    restore();
  }
}, 30_000);

test("a clone without sshBatch runs ssh as the user set it up", async () => {
  const restore = captureEnv("GIT_SSH_COMMAND");
  const { log, ssh } = await fakeSsh();
  process.env.GIT_SSH_COMMAND = `${ssh} -o User=me`;
  try {
    await ensureClone(`ssh://niksi-test.invalid${remote}`);
    const calls = await sshCalls(log);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call).not.toContain("BatchMode");
  } finally {
    restore();
  }
}, 30_000);

test("a failure on both addresses reports the https attempt the user named", async () => {
  await expect(cloneOrFetch("https://niksi-test.invalid/demo")).rejects.toThrow(
    "cannot reach https://niksi-test.invalid/demo (",
  );
}, 30_000);

test("gitReason names auth and not-found failures and passes the rest through", () => {
  const remedy = "Private repos need an ssh key or a git credential helper that can read them.";
  expect(
    gitReason({
      err: "fatal: could not read Username for 'https://github.com': terminal prompts disabled\n",
    }),
  ).toBe(` (authentication failed)\n${remedy}`);
  expect(
    gitReason({
      err: "git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.\n",
    }),
  ).toBe(` (authentication failed)\n${remedy}`);
  expect(
    gitReason({
      err: "remote: Repository not found.\nfatal: repository 'https://github.com/o/r/' not found\n",
    }),
  ).toBe(
    " (repository not found)\nCheck the name. A private repo also reads as not found when git has no credentials for it.",
  );
  expect(
    gitReason({
      err: "fatal: unable to access 'x': SSL certificate problem: unable to get local issuer certificate\n",
    }),
  ).toBe(
    " (unable to access 'x': SSL certificate problem: unable to get local issuer certificate)",
  );
  expect(gitReason({ err: "" })).toBe("");
});

const ADVISORY =
  "fatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.\n";

test("gitReason says a source is not a Git repository in plain words", () => {
  expect(
    gitReason({ err: `fatal: '/srv/gone' does not appear to be a git repository\n${ADVISORY}` }),
  ).toBe(" (not a Git repository)");
  expect(gitReason({ err: "fatal: repository '/srv/gone' does not exist\n" })).toBe(
    " (not a Git repository)",
  );
});

test("gitReason keeps the first fatal line, not the advisory paragraph after it", () => {
  expect(
    gitReason({ err: `fatal: protocol error: bad line length character: Welc\n${ADVISORY}` }),
  ).toBe(" (protocol error: bad line length character: Welc)");
});

test("gitReason says a host cannot be found in plain words", () => {
  expect(
    gitReason({
      err: "fatal: unable to access 'https://nope.invalid/x/': Could not resolve host: nope.invalid\n",
    }),
  ).toBe(" (host not found)");
  expect(
    gitReason({
      err: `ssh: Could not resolve hostname nope.invalid: nodename nor servname provided, or not known\r\n${ADVISORY}`,
    }),
  ).toBe(" (host not found)");
  expect(
    gitReason({
      err: "fatal: unable to look up nope.invalid (port 9418) (nodename nor servname provided, or not known)\n",
    }),
  ).toBe(" (host not found)");
});

test("gitReason says a connection failed in plain words", () => {
  for (const err of [
    "fatal: unable to access 'http://127.0.0.1:9/x/': Failed to connect to 127.0.0.1 port 9 after 0 ms: Couldn't connect to server\n",
    "fatal: unable to access 'https://x/': Connection timed out after 300001 milliseconds\n",
    `ssh: connect to host 127.0.0.1 port 9: Connection refused\r\n${ADVISORY}`,
    `ssh: connect to host 192.0.2.1 port 22: Operation timed out\r\n${ADVISORY}`,
    "fatal: unable to connect to 127.0.0.1:\n127.0.0.1[0: 127.0.0.1]: errno=Connection refused\n",
  ]) {
    expect(gitReason({ err })).toBe(" (connection failed)");
  }
});

test("gitReason keeps ssh's explanation over git's generic fatal line", () => {
  expect(gitReason({ err: `Connection closed by 192.0.2.1 port 22\r\n${ADVISORY}` })).toBe(
    " (Connection closed by 192.0.2.1 port 22)",
  );
});

test("gitReason takes the first error line past hints and warnings when there is no fatal line", () => {
  expect(
    gitReason({
      err: "hint: Run 'git maintenance' to repack.\nwarning: refname 'main' is ambiguous.\nerror: unable to read tree 0123abcd\nerror: could not fetch 0123abcd from promisor remote\n",
    }),
  ).toBe(" (unable to read tree 0123abcd)");
});

test("gitReason joins a wrapped paragraph when git names no fatal or error line", () => {
  expect(
    gitReason({
      err: "\nPlease make sure you have the correct access rights\nand the repository exists.\n",
    }),
  ).toBe(" (Please make sure you have the correct access rights and the repository exists.)");
});

test("gitReason keeps a warning when it is all git printed", () => {
  expect(gitReason({ err: "warning: unable to access '/home/me/.config/git/attributes'\n" })).toBe(
    " (warning: unable to access '/home/me/.config/git/attributes')",
  );
});

test("gitReason skips ssh's warnings and keeps the server's error before git's generic line", () => {
  expect(
    gitReason({
      err: `Warning: Permanently added 'git.example.com' (ED25519) to the list of known hosts.\r\nERROR: Repository not found.\n${ADVISORY}`,
    }),
  ).toBe(" (ERROR: Repository not found.)");
  expect(
    gitReason({
      err: `** WARNING: connection is not using a post-quantum key exchange algorithm.\n** This session may be vulnerable to "store now, decrypt later" attacks.\n** The server may need to be upgraded. See https://openssh.com/pq.html\nfatal: '/srv/gone' does not appear to be a git repository\n${ADVISORY}`,
    }),
  ).toBe(" (not a Git repository)");
});

test("gitReason prefers git's specific fatal line over server text before it", () => {
  expect(
    gitReason({
      err: "remote: Internal Server Error\nfatal: unable to access 'https://x/': The requested URL returned error: 500\n",
    }),
  ).toBe(" (unable to access 'https://x/': The requested URL returned error: 500)");
});

// gitlab-shell frames a server error in bare `remote: ` lines and a ruler of 72 `=`
// (internal/console/console.go), then git adds its generic fatal line.
const gitlabBanner = (message: string): string => {
  const blank = "remote: \n";
  const ruler = `remote: ${"=".repeat(72)}\n`;
  return `${blank}${ruler}${blank}remote: ${message}\n${blank}${ruler}${blank}${ADVISORY}`;
};

test("gitReason keeps the server's error inside a GitLab ssh banner", () => {
  expect(
    gitReason({
      err: gitlabBanner(
        "ERROR: The project you were looking for could not be found or you don't have permission to view it.",
      ),
    }),
  ).toBe(
    " (remote: ERROR: The project you were looking for could not be found or you don't have permission to view it.)",
  );
});

test("gitReason never gives a bare prefix or a ruler as the reason", () => {
  const banner = `remote: \nremote: ${"=".repeat(72)}\nremote: \n`;
  expect(gitReason({ err: `${banner}${ADVISORY}` })).toBe(
    " (Could not read from remote repository.)",
  );
  expect(gitReason({ err: banner })).toBe("");
  expect(gitReason({ err: `${banner}Connection reset by peer\n` })).toBe(
    " (Connection reset by peer)",
  );
  expect(gitReason({ err: "error: \nerror: unable to read tree 0123abcd\n" })).toBe(
    " (unable to read tree 0123abcd)",
  );
});
