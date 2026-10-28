import { afterAll, beforeAll, expect, test } from "bun:test";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  cliRunner,
  commitAll,
  initRepo,
  makeSkill,
  tagHead,
  terminalRunner,
  type RunCli,
  type RunTerminal,
} from "../test-cli.ts";
import { captureEnv } from "../test-env.ts";

interface LockSkill {
  commit?: string;
  [key: string]: unknown;
}

type LockSkills = Record<string, LockSkill>;

interface UpdateFixture {
  project: string;
  lockPath: string;
  repo: string;
  before: LockSkills;
  upstreamCommit: string;
}

let tmp: string;
let runCli: RunCli;
let runTerminal: RunTerminal;
const restoreEnv = captureEnv("HOME", "NIKSI_HOME");

beforeAll(async () => {
  tmp = await realpath(await mkdtemp(join(tmpdir(), "niksi-update-cli-test-")));
  process.env.HOME = tmp;
  process.env.NIKSI_HOME = join(tmp, "niksi-home");
  runCli = cliRunner(tmp);
  runTerminal = terminalRunner(tmp);
});

afterAll(async () => {
  restoreEnv();
  await rm(tmp, { recursive: true, force: true });
});

const readSkills = async (lockPath: string): Promise<LockSkills> =>
  JSON.parse(await readFile(lockPath, "utf8")).skills;

const PATH_COPY = ["--copy", "--path", "published"];
const LINK = ["-p", "--agent", "claude"];

const setupUpdate = async (
  name: string,
  skills: string[],
  changed: string[],
  placement = PATH_COPY,
  ref = "",
): Promise<UpdateFixture> => {
  const project = join(tmp, `${name}-project`);
  const repo = join(tmp, `${name}-source`);
  await mkdir(join(project, ".git"), { recursive: true });
  await mkdir(repo, { recursive: true });
  for (const skill of skills) await makeSkill(repo, skill, "version one\n");
  await writeFile(join(repo, "README.md"), "version one\n");
  await initRepo(repo);
  await commitAll(repo, "version one");
  await tagHead(repo, "v1.0.0");

  const source = `${pathToFileURL(repo).href}${ref}`;
  const added = await runCli(project, "add", source, "--all", ...placement, "--yes");
  expect(added.exitCode).toBe(0);
  const lockPath = join(project, "niksi-lock.json");
  const before = await readSkills(lockPath);

  for (const skill of changed) await makeSkill(repo, skill, "version two\n");
  await writeFile(join(repo, "README.md"), "version two\n");
  const upstreamCommit = await commitAll(repo, "version two");
  await tagHead(repo, "v1.1.0");
  return { project, repo, lockPath, before, upstreamCommit };
};

test("naming one skill leaves every other candidate unchanged", async () => {
  const fixture = await setupUpdate("named", ["selected", "moved", "other"], ["selected", "other"]);

  const result = await runCli(fixture.project, "update", "selected", "--yes");

  expect(result.exitCode).toBe(0);
  const after = await readSkills(fixture.lockPath);
  expect(after.selected?.commit).toBe(fixture.upstreamCommit);
  expect(after.moved).toEqual(fixture.before.moved);
  expect(after.other).toEqual(fixture.before.other);
  expect(result.stdout).toContain("moved: update available, not selected");
  expect(result.stdout).toContain("other: update available, not selected");
});

test("declining confirmation leaves a moved entry at its recorded revision", async () => {
  const fixture = await setupUpdate("declined", ["moved"], []);
  const before = await readFile(fixture.lockPath, "utf8");

  const result = await runTerminal(
    fixture.project,
    [{ on: "Update moved (project)?", send: "n\r" }],
    "update",
    "moved",
  );

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("no file changes");
  expect(result.stdout).not.toContain("Review files before installing.");
  expect(await readFile(fixture.lockPath, "utf8")).toBe(before);
});

test("--all updates moved and outdated skills and counts both", async () => {
  const fixture = await setupUpdate("all", ["moved", "changed"], ["changed"]);

  const result = await runCli(fixture.project, "update", "--all", "--yes");

  expect(result.exitCode).toBe(0);
  const after = await readSkills(fixture.lockPath);
  expect(after.moved?.commit).toBe(fixture.upstreamCommit);
  expect(after.changed?.commit).toBe(fixture.upstreamCommit);
  expect(result.stdout).toContain("no file changes");
  expect(result.stdout).toContain("Updated 2 skill(s).");
  expect(result.stdout).not.toContain("\x1b");
});

test("a pinned skill updates only when named", async () => {
  const fixture = await setupUpdate("pinned", ["pinned"], ["pinned"], LINK, "@v1.0.0");
  const before = await readFile(fixture.lockPath, "utf8");
  const installed = join(fixture.project, ".claude", "skills", "pinned", "SKILL.md");

  const skipped = await runCli(fixture.project, "update", "--all", "--yes");
  expect(skipped.exitCode).toBe(0);
  expect(await readFile(fixture.lockPath, "utf8")).toBe(before);
  expect(await readFile(installed, "utf8")).toContain("version one");

  const named = await runCli(fixture.project, "update", "pinned", "--yes");
  expect(named.exitCode).toBe(0);
  expect((await readSkills(fixture.lockPath)).pinned?.commit).toBe(fixture.upstreamCommit);
  expect(await readFile(installed, "utf8")).toContain("version two");
});

test("updating a modified link skill discards the edits", async () => {
  const fixture = await setupUpdate("modified-link", ["edited"], ["edited"], LINK);
  const canonical = join(fixture.project, ".niksi", "skills", "edited", "SKILL.md");
  await writeFile(canonical, "local edit\n");

  const result = await runCli(fixture.project, "update", "--all", "--yes");

  expect(result.exitCode).toBe(0);
  expect(await readFile(canonical, "utf8")).toContain("version two");
  expect((await readSkills(fixture.lockPath)).edited?.commit).toBe(fixture.upstreamCommit);
});

test("--report writes the updated, blocked, and skipped skills as Markdown", async () => {
  const fixture = await setupUpdate("report", ["clean", "risky", "blocked", "moved", "kept"], []);
  const repo = join(tmp, "report-source");
  for (const name of ["clean", "risky", "blocked", "kept"]) {
    await makeSkill(repo, name, "version three\n");
  }
  await writeFile(join(repo, "risky", "run.sh"), "echo hi\n");
  await chmod(join(repo, "risky", "run.sh"), 0o755);
  await writeFile(join(repo, "blocked", "hooks.json"), "{}\n");
  const upstream = (await commitAll(repo, "version three")).slice(0, 8);
  await tagHead(repo, "v1.2.0");
  const from = fixture.before.clean!.commit!.slice(0, 8);

  const result = await runCli(
    fixture.project,
    "update",
    "clean",
    "risky",
    "blocked",
    "moved",
    "--yes",
    "--report",
    "update.md",
  );

  expect(result.exitCode).toBe(3);
  const after = await readSkills(fixture.lockPath);
  expect(after.clean?.commit?.slice(0, 8)).toBe(upstream);
  expect(after.blocked).toEqual(fixture.before.blocked);
  const report = await readFile(join(fixture.project, "update.md"), "utf8");
  const range = `\`v1.0.0\` (\`${from}\`) → \`v1.2.0\` (\`${upstream}\`)`;
  expect(report).toStartWith(
    [
      "## nik update (project)",
      "",
      "### Updated",
      "",
      "#### `moved`",
      "",
      range,
      "",
      "No file changes.",
    ].join("\n"),
  );
  expect(report).toContain(
    ["#### `clean`", "", range, "", "```text", " SKILL.md | 2 +-"].join("\n"),
  );
  expect(report).toMatch(/#### `risky`[^#]+Warn:\n\n- `executable` \([^)]+\) in `run.sh`/u);
  expect(report).toContain(
    "### Needs a person\n\nCritical findings block these skills until someone approves them in a terminal: `nik update blocked`.",
  );
  expect(report).toMatch(/#### `blocked`[^#]+Critical:\n\n- `agent-config` [^\n]+`hooks.json`/u);
  expect(report).toContain("### Not updated\n\n- `kept`: update available, not selected\n");
});

test("--report records a run with nothing to update", async () => {
  const fixture = await setupUpdate("report-none", ["fresh"], []);
  await runCli(fixture.project, "update", "--all", "--yes");

  const result = await runCli(fixture.project, "update", "--all", "--yes", "--report", "none.md");

  expect(result.exitCode).toBe(0);
  expect(await readFile(join(fixture.project, "none.md"), "utf8")).toBe(
    "## nik update (project)\n\n### Up to date\n\n`fresh`\n",
  );
});

test("--report into a missing directory or onto a directory exits 2 before checking upstream", async () => {
  const fixture = await setupUpdate("report-missing", ["kept"], ["kept"]);
  const before = await readFile(fixture.lockPath, "utf8");

  const cases: [string, string][] = [
    ["no/such.md", "Report directory not found:"],
    [".", "Pass a file to --report, not a directory:"],
  ];
  for (const [target, message] of cases) {
    const result = await runCli(fixture.project, "update", "--all", "--yes", "--report", target);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(message);
    expect(await readFile(fixture.lockPath, "utf8")).toBe(before);
  }
});

test("a moved-only run without selection does not write the lockfile", async () => {
  const fixture = await setupUpdate("moved-only", ["moved"], []);
  const before = await readFile(fixture.lockPath, "utf8");

  const result = await runCli(fixture.project, "update");

  expect(result.exitCode).toBe(2);
  expect(result.stderr).toContain("Pass skill names or --all.");
  expect(await readFile(fixture.lockPath, "utf8")).toBe(before);
});

test("a lockfile commit shaped as a git option stops update before git runs", async () => {
  const fixture = await setupUpdate("planted", ["planted"], ["planted"]);
  const probe = join(tmp, "planted-probe");
  await mkdir(probe);
  const lock = JSON.parse(await readFile(fixture.lockPath, "utf8"));
  lock.skills.planted.commit = `--output=${join(probe, "PWNED")}`;
  const planted = `${JSON.stringify(lock, null, 2)}\n`;
  await writeFile(fixture.lockPath, planted);

  for (const args of [["planted"], ["--all", "--yes", "--dangerous-skip-critical-approval"]]) {
    const result = await runCli(fixture.project, "update", ...args);
    expect(result.exitCode).toBe(1);
    expect(await readdir(probe)).toEqual([]);
    expect(await readFile(fixture.lockPath, "utf8")).toBe(planted);
  }
});

test("a skill added from a forge URL subtree keeps its root, and the dependency hint resolves under it", async () => {
  const forge = "https://github.com/o/plugin-collection";
  const repo = join(tmp, "plugin-collection");
  const project = join(tmp, "rooted-project");
  await mkdir(join(project, ".git"), { recursive: true });
  await makeSkill(join(repo, "plugins", "x"), "primary", "version one\n");
  await makeSkill(join(repo, "plugins", "x"), "helper");
  await makeSkill(join(repo, "plugins", "y"), "friend");
  await initRepo(repo);
  await commitAll(repo, "version one");
  const restore = captureEnv("GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0");
  process.env.GIT_CONFIG_COUNT = "1";
  process.env.GIT_CONFIG_KEY_0 = `url.${pathToFileURL(repo).href}.insteadOf`;
  process.env.GIT_CONFIG_VALUE_0 = forge;
  try {
    const lockPath = join(project, "niksi-lock.json");
    const added = await runCli(
      project,
      "add",
      `${forge}/tree/main/plugins/x`,
      "primary",
      ...LINK,
      "--yes",
    );
    expect(added.exitCode).toBe(0);
    expect((await readSkills(lockPath)).primary).toMatchObject({
      source: forge,
      path: "plugins/x/primary",
      root: "plugins/x",
      track: "auto",
    });

    await makeSkill(join(repo, "plugins", "x"), "primary", "Use /helper and /friend.\n");
    const upstreamCommit = await commitAll(repo, "mention dependencies");
    const updated = await runCli(project, "update", "--all", "--yes");
    expect(updated.exitCode).toBe(0);
    expect((await readSkills(lockPath)).primary).toMatchObject({
      commit: upstreamCommit,
      root: "plugins/x",
    });
    expect(updated.stdout).not.toContain("mentions friend");
    const hint = /Add them: nik add (\S+) (.+)$/mu.exec(updated.stdout);
    expect(hint?.slice(1)).toEqual([`${forge}/tree/main/plugins/x`, "helper"]);

    const pasted = await runCli(project, "add", hint![1]!, hint![2]!, ...LINK, "--yes");
    expect(pasted.exitCode).toBe(0);
    expect((await readSkills(lockPath)).helper).toMatchObject({
      path: "plugins/x/helper",
      root: "plugins/x",
    });

    await writeFile(join(repo, "README.md"), "moved\n");
    const movedCommit = await commitAll(repo, "readme only");
    expect((await runCli(project, "update", "--all", "--yes")).exitCode).toBe(0);
    expect((await runCli(project, "disable", "primary", "--yes")).exitCode).toBe(0);
    expect((await runCli(project, "enable", "primary", ...LINK, "--yes")).exitCode).toBe(0);
    const after = await readSkills(lockPath);
    expect(after.primary).toMatchObject({ commit: movedCommit, root: "plugins/x" });
    expect(after.primary?.disabled).toBeUndefined();
    expect(after.helper).toMatchObject({ commit: movedCommit, root: "plugins/x" });
  } finally {
    restore();
  }
});

const expectListMatchesLock = async (project: string, lockPath: string): Promise<void> => {
  const skills = await readSkills(lockPath);
  const listed = await runCli(project, "list", "--json");
  expect(listed.exitCode).toBe(0);
  const rows: LockSkill[] = JSON.parse(listed.stdout).skills;
  expect(rows.map((row) => row.name).toSorted()).toEqual(Object.keys(skills).toSorted());
  for (const row of rows) {
    expect(row).toMatchObject({ ...skills[String(row.name)], modified: false });
  }
};

const publishedSkill = (project: string, name: string): Promise<string> =>
  readFile(join(project, "published", name, "SKILL.md"), "utf8");

const setupLocalGone = async (name: string): Promise<{ project: string; lockPath: string }> => {
  const project = join(tmp, `${name}-project`);
  await mkdir(join(project, ".git"), { recursive: true });
  for (const skill of ["qa", "kept"]) await makeSkill(join(project, "skills"), skill);
  const added = await runCli(project, "add", "./skills", "--all", ...LINK, "--yes");
  expect(added.exitCode).toBe(0);
  await rm(join(project, "skills", "qa"), { recursive: true });
  await makeSkill(join(project, "skills"), "kept", "version two\n");
  return { project, lockPath: join(project, "niksi-lock.json") };
};

test.each([
  { label: "named", args: ["qa", "kept"] },
  { label: "all", args: ["--all"] },
])(
  "a local source that lost a requested skill exits 1 after updating the rest ($label)",
  async ({ label, args }) => {
    const fixture = await setupLocalGone(`local-gone-${label}`);
    const before = await readSkills(fixture.lockPath);

    const result = await runCli(fixture.project, "update", ...args, "--project", "--yes");

    expect(result.exitCode).toBe(1);
    const after = await readSkills(fixture.lockPath);
    expect(after.qa).toEqual(before.qa);
    expect(after.kept?.integrity).not.toBe(before.kept?.integrity);
    const kept = join(fixture.project, ".claude", "skills", "kept", "SKILL.md");
    expect(await readFile(kept, "utf8")).toContain("version two");
    expect(result.stdout).not.toContain("qa: up to date");
    await expectListMatchesLock(fixture.project, fixture.lockPath);
  },
);

test("a Git source that lost a named skill exits 1 after updating the rest", async () => {
  const fixture = await setupUpdate("git-gone", ["dropped", "kept"], ["kept"]);
  const repo = join(tmp, "git-gone-source");
  await rm(join(repo, "dropped"), { recursive: true });
  const upstreamCommit = await commitAll(repo, "drop a skill");
  await tagHead(repo, "v1.2.0");

  const result = await runCli(fixture.project, "update", "dropped", "kept", "--yes");

  expect(result.exitCode).toBe(1);
  const after = await readSkills(fixture.lockPath);
  expect(after.dropped).toEqual(fixture.before.dropped);
  expect(after.kept?.commit).toBe(upstreamCommit);
  expect(await publishedSkill(fixture.project, "dropped")).toContain("version one");
  expect(await publishedSkill(fixture.project, "kept")).toContain("version two");
  await expectListMatchesLock(fixture.project, fixture.lockPath);
});

test("--all exits 1 when a source is unreachable, after updating the rest", async () => {
  const fixture = await setupUpdate("all-unreachable", ["lost", "kept"], ["kept"]);
  const lock = JSON.parse(await readFile(fixture.lockPath, "utf8"));
  lock.skills.lost.source = pathToFileURL(join(tmp, "all-unreachable-missing")).href;
  await writeFile(fixture.lockPath, `${JSON.stringify(lock, null, 2)}\n`);

  const result = await runCli(fixture.project, "update", "--all", "--yes");

  expect(result.exitCode).toBe(1);
  const after = await readSkills(fixture.lockPath);
  expect(after.lost).toEqual(lock.skills.lost);
  expect(after.kept?.commit).toBe(fixture.upstreamCommit);
  expect(await publishedSkill(fixture.project, "lost")).toContain("version one");
  expect(await publishedSkill(fixture.project, "kept")).toContain("version two");
  await expectListMatchesLock(fixture.project, fixture.lockPath);
});

test("--all leaves out a pinned skill whose source is unreachable, naming it fails", async () => {
  const fixture = await setupUpdate("pinned-unreachable", ["pinned"], ["pinned"], LINK, "@v1.0.0");
  const lock = JSON.parse(await readFile(fixture.lockPath, "utf8"));
  lock.skills.pinned.source = pathToFileURL(join(tmp, "pinned-unreachable-missing")).href;
  const planted = `${JSON.stringify(lock, null, 2)}\n`;
  await writeFile(fixture.lockPath, planted);
  const installed = join(fixture.project, ".claude", "skills", "pinned", "SKILL.md");

  for (const [args, exitCode] of [
    [["--all"], 0],
    [["pinned"], 1],
  ] as const) {
    const result = await runCli(fixture.project, "update", ...args, "--yes");
    expect(result.exitCode).toBe(exitCode);
    expect(await readFile(fixture.lockPath, "utf8")).toBe(planted);
    expect(await readFile(installed, "utf8")).toContain("version one");
  }
  await expectListMatchesLock(fixture.project, fixture.lockPath);
});

const setupMixedSources = async (name: string): Promise<UpdateFixture> => {
  const fixture = await setupUpdate(name, ["remote"], ["remote"]);
  await makeSkill(join(fixture.project, "skills"), "own", "version one\n");
  const added = await runCli(fixture.project, "add", "./skills", "--all", ...LINK, "--yes");
  expect(added.exitCode).toBe(0);
  await makeSkill(join(fixture.project, "skills"), "own", "version two\n");
  return { ...fixture, before: await readSkills(fixture.lockPath) };
};

test("--source selects every skill from one source and checks no other source", async () => {
  const fixture = await setupMixedSources("by-source");
  const own = join(fixture.project, ".claude", "skills", "own", "SKILL.md");
  const lockBefore = await readFile(fixture.lockPath, "utf8");

  const unconfirmed = await runCli(fixture.project, "update", "--source", "local");
  expect(unconfirmed.exitCode).toBe(2);
  expect(unconfirmed.stderr).toContain("Pass -y to proceed.");
  expect(await readFile(fixture.lockPath, "utf8")).toBe(lockBefore);

  const git = await runCli(
    fixture.project,
    "update",
    "--source",
    pathToFileURL(fixture.repo).href,
    "--yes",
  );
  expect(git.exitCode).toBe(0);
  let after = await readSkills(fixture.lockPath);
  expect(after.remote?.commit).toBe(fixture.upstreamCommit);
  expect(after.own).toEqual(fixture.before.own);
  expect(await publishedSkill(fixture.project, "remote")).toContain("version two");
  expect(await readFile(own, "utf8")).toContain("version one");

  const lock = JSON.parse(await readFile(fixture.lockPath, "utf8"));
  lock.skills.remote.source = pathToFileURL(join(tmp, "by-source-missing")).href;
  await writeFile(fixture.lockPath, `${JSON.stringify(lock, null, 2)}\n`);

  const local = await runCli(fixture.project, "update", "--source", "local", "--yes");
  expect(local.exitCode).toBe(0);
  after = await readSkills(fixture.lockPath);
  expect(after.remote).toEqual(lock.skills.remote);
  expect(after.own?.integrity).not.toBe(fixture.before.own?.integrity);
  expect(await readFile(own, "utf8")).toContain("version two");
  expect(local.stdout).not.toContain("no upstream");
  await expectListMatchesLock(fixture.project, fixture.lockPath);
});

test("--source exits 1 when no installed skill comes from the source", async () => {
  const fixture = await setupMixedSources("by-source-none");
  const before = await readFile(fixture.lockPath, "utf8");

  const result = await runCli(fixture.project, "update", "--source", "o/r", "--yes");

  expect(result.exitCode).toBe(1);
  expect(await readFile(fixture.lockPath, "utf8")).toBe(before);
});

test.each([
  { label: "with names", args: ["own", "--source", "local"], message: "not both" },
  { label: "with a skill path", args: ["--source", "o/r/own"], message: "o/r/own" },
  {
    label: "with a forge URL path",
    args: ["--source", "https://github.com/o/r/tree/main/skills"],
    message: "names a skill or ref inside a source",
  },
  { label: "twice", args: ["--source", "local", "--source", "o/r"], message: "once" },
])("--source $label exits 2 before checking upstream", async ({ args, message }) => {
  const result = await runCli(tmp, "update", ...args, "--yes");

  expect(result.exitCode).toBe(2);
  expect(result.stderr).toContain(message);
});
