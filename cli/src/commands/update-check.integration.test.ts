import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  cliRunner,
  commitAll,
  initRepo,
  makeSkill,
  recordedLock,
  tagHead,
  type RunCli,
} from "../test-cli.ts";
import { captureEnv } from "../test-env.ts";

let tmp: string;
let runCli: RunCli;
let project: string;
let repo: string;
let source: string;
let lockPath: string;
let firstCommit: string;
let secondCommit: string;
const restoreEnv = captureEnv("HOME", "NIKSI_HOME", "GIT_SSH_COMMAND");

const LINK = ["-p", "--agent", "claude", "--yes"];
const CHECK = ["update", "--check"];

const add = async (cwd: string, ...args: string[]): Promise<void> => {
  const result = await runCli(cwd, "add", ...args, ...LINK);
  expect(result.exitCode).toBe(0);
};

beforeAll(async () => {
  tmp = await realpath(await mkdtemp(join(tmpdir(), "niksi-update-check-cli-test-")));
  process.env.HOME = tmp;
  process.env.NIKSI_HOME = join(tmp, "niksi-home");
  runCli = cliRunner(tmp);

  repo = join(tmp, "source");
  for (const name of ["changed", "moved", "pinned"]) await makeSkill(repo, name, "version one\n");
  await initRepo(repo);
  firstCommit = await commitAll(repo, "version one");
  await tagHead(repo, "v1.0.0");
  source = pathToFileURL(repo).href;

  project = join(tmp, "project");
  await mkdir(join(project, ".git"), { recursive: true });
  await makeSkill(join(project, "skills"), "mine");
  await add(project, source, "changed", "moved");
  await add(project, `${source}@v1.0.0`, "pinned");
  await add(project, "./skills/mine");
  lockPath = join(project, "niksi-lock.json");

  for (const name of ["changed", "pinned"]) await makeSkill(repo, name, "version two\n");
  secondCommit = await commitAll(repo, "version two");
  await tagHead(repo, "v1.1.0");
});

afterAll(async () => {
  restoreEnv();
  await rm(tmp, { recursive: true, force: true });
});

test("update --check --json reports each skill's recorded and upstream revision without a terminal, and exits 1", async () => {
  const before = await readFile(lockPath, "utf8");

  const result = await runCli(project, ...CHECK, "--json");

  expect(result.exitCode).toBe(1);
  expect(JSON.parse(result.stdout)).toEqual({
    scope: "project",
    lockfile: lockPath,
    skills: [
      {
        name: "changed",
        source,
        path: "changed",
        track: "auto",
        verdict: "outdated",
        recorded: { commit: firstCommit, tag: "v1.0.0" },
        upstream: { commit: secondCommit, tag: "v1.1.0" },
      },
      {
        name: "mine",
        source: "local:.",
        path: "skills/mine",
        track: "auto",
        verdict: "up-to-date",
        recorded: {},
        upstream: {},
      },
      {
        name: "moved",
        source,
        path: "moved",
        track: "auto",
        verdict: "moved",
        recorded: { commit: firstCommit, tag: "v1.0.0" },
        upstream: { commit: secondCommit, tag: "v1.1.0" },
      },
      {
        name: "pinned",
        source,
        path: "pinned",
        track: "pin",
        verdict: "pinned",
        recorded: { commit: firstCommit, pinnedAs: "v1.0.0" },
        upstream: { commit: secondCommit, tag: "v1.1.0", pinnedAs: "v1.1.0" },
      },
    ],
    disabled: [],
    blocked: [],
  });
  expect(await readFile(lockPath, "utf8")).toBe(before);
});

test("update --check exits 0 when every checked skill is up to date and names disabled skills without checking them", async () => {
  const local = join(tmp, "local-project");
  await mkdir(join(local, ".git"), { recursive: true });
  for (const name of ["kept", "off"]) {
    await makeSkill(join(local, "skills"), name);
    await add(local, `./skills/${name}`);
  }
  expect((await runCli(local, "disable", "off", "--yes")).exitCode).toBe(0);

  const result = await runCli(local, ...CHECK, "--json");

  expect(result.exitCode).toBe(0);
  const output = JSON.parse(result.stdout);
  expect(
    output.skills.map(({ name, verdict }: { name: string; verdict: string }) => [name, verdict]),
  ).toEqual([["kept", "up-to-date"]]);
  expect(output.disabled).toEqual(["off"]);
});

test("update --check --json reports an unreachable source with its error and exits 1", async () => {
  const gone = join(tmp, "gone-source");
  await makeSkill(gone, "lost");
  await initRepo(gone);
  await commitAll(gone, "only");
  const lost = join(tmp, "unreachable-project");
  await mkdir(join(lost, ".git"), { recursive: true });
  await add(lost, pathToFileURL(gone).href, "lost");
  await rm(gone, { recursive: true, force: true });

  const result = await runCli(lost, ...CHECK, "--json");

  expect(result.exitCode).toBe(1);
  const [skill] = JSON.parse(result.stdout).skills;
  expect(skill).toMatchObject({ name: "lost", verdict: "unreachable", upstream: {} });
  expect(skill.error).toEqual(expect.any(String));
});

test("update --check leaves out a skill whose source niksi.json does not allow and exits 3", async () => {
  const guarded = join(tmp, "policy-project");
  await mkdir(join(guarded, ".git"), { recursive: true });
  await add(guarded, source, "changed");
  await writeFile(
    join(guarded, "niksi.json"),
    JSON.stringify({ policy: { sources: { git: ["https://example.com/other.git"] } } }),
  );

  const result = await runCli(guarded, ...CHECK, "--json");

  expect(result.exitCode).toBe(3);
  const output = JSON.parse(result.stdout);
  expect(output.skills).toEqual([]);
  expect(output.blocked).toEqual(["changed"]);
});

test("update --check without --json lists the skills with updates, points to nik update, and exits 1", async () => {
  const result = await runCli(project, ...CHECK);

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toContain("changed: 1 new commit(s) (v1.0.0 → v1.1.0)");
  expect(result.stdout).toContain("moved: no file changes");
  expect(result.stdout).toContain("pinned: pinned at v1.0.0. Latest: v1.1.0.");
  expect(result.stdout).toContain(
    "4 skill(s) checked (project): 1 outdated, 1 up to date, 1 moved, 1 pinned.",
  );
  expect(result.stdout).toContain("Run nik update to choose which updates to install.");
});

test.each([
  { args: ["changed"], message: "Do not combine --check with skill names." },
  { args: ["--all"], message: "Do not combine --check with --all." },
  { args: ["--source", "local"], message: "Do not combine --check with --source." },
  { args: ["--yes"], message: "Do not combine --check with --yes." },
  {
    args: ["--dangerous-skip-critical-approval"],
    message: "Do not combine --check with --dangerous-skip-critical-approval.",
  },
  { args: ["--report", "report.md"], message: "Do not combine --check with --report." },
  { args: ["--min-release-age", "0"], message: "Do not combine --check with --min-release-age." },
])("update --check with $args exits 2 and writes nothing", async ({ args, message }) => {
  const before = await readFile(lockPath, "utf8");

  const result = await runCli(project, ...CHECK, ...args);

  expect(result.exitCode).toBe(2);
  expect(result.stderr).toContain(message);
  expect(result.stdout).toBe("");
  expect(await readFile(lockPath, "utf8")).toBe(before);
});

test("update --json without --check exits 2 and writes nothing", async () => {
  const before = await readFile(lockPath, "utf8");

  const result = await runCli(project, "update", "--json");

  expect(result.exitCode).toBe(2);
  expect(result.stderr).toContain("Pass --check with --json.");
  expect(await readFile(lockPath, "utf8")).toBe(before);
});

test("update --check runs ssh in batch mode, so ssh fails instead of asking for a host key or passphrase", async () => {
  const sshProject = join(tmp, "ssh-project");
  await mkdir(join(sshProject, ".git"), { recursive: true });
  await writeFile(
    join(sshProject, "niksi-lock.json"),
    JSON.stringify(recordedLock("ssh://git@example.invalid/o/r.git", "remote")),
  );
  const log = join(tmp, "ssh-args.log");
  const fakeSsh = join(tmp, "fake-ssh");
  await writeFile(fakeSsh, `#!/bin/sh\necho "$@" >> ${log}\nexit 255\n`);
  await chmod(fakeSsh, 0o755);
  process.env.GIT_SSH_COMMAND = fakeSsh;

  const result = await runCli(sshProject, ...CHECK, "--json");

  expect(result.exitCode).toBe(1);
  expect(JSON.parse(result.stdout).skills[0].verdict).toBe("unreachable");
  expect(await readFile(log, "utf8")).toContain("BatchMode=yes");
});
