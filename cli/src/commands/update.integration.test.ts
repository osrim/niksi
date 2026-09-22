import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { $ } from "bun";
import { cliRunner, makeSkill, type RunCli, type RunResult } from "../test-cli.ts";
import { captureEnv } from "../test-env.ts";

interface LockSkill {
  commit?: string;
  [key: string]: unknown;
}

type LockSkills = Record<string, LockSkill>;

interface UpdateFixture {
  project: string;
  lockPath: string;
  before: LockSkills;
  upstreamCommit: string;
}

let tmp: string;
let runCli: RunCli;
const restoreEnv = captureEnv("HOME", "NIKSI_HOME");
const cli = join(import.meta.dir, "..", "index.ts");

beforeAll(async () => {
  tmp = await realpath(await mkdtemp(join(tmpdir(), "niksi-update-cli-test-")));
  process.env.HOME = tmp;
  process.env.NIKSI_HOME = join(tmp, "niksi-home");
  runCli = cliRunner(tmp);
});

afterAll(async () => {
  restoreEnv();
  await rm(tmp, { recursive: true, force: true });
});

const readSkills = async (lockPath: string): Promise<LockSkills> =>
  JSON.parse(await readFile(lockPath, "utf8")).skills;

const commit = async (repo: string, message: string): Promise<string> => {
  await $`git -C ${repo} add -A`.quiet();
  await $`git -C ${repo} -c commit.gpgsign=false -c user.email=test@example.com -c user.name=test commit -q -m ${message}`.quiet();
  return (await $`git -C ${repo} rev-parse HEAD`.text()).trim();
};

const tag = async (repo: string, name: string): Promise<void> => {
  await $`git -C ${repo} -c tag.gpgSign=false -c tag.forceSignAnnotated=false tag ${name}`.quiet();
};

const setupUpdate = async (
  name: string,
  skills: string[],
  changed: string[],
): Promise<UpdateFixture> => {
  const project = join(tmp, `${name}-project`);
  const repo = join(tmp, `${name}-source`);
  await mkdir(join(project, ".git"), { recursive: true });
  await mkdir(repo, { recursive: true });
  for (const skill of skills) await makeSkill(repo, skill, "version one\n");
  await writeFile(join(repo, "README.md"), "version one\n");
  await $`git -C ${repo} init -q -b main --template=`.quiet();
  await commit(repo, "version one");
  await tag(repo, "v1.0.0");

  const source = pathToFileURL(repo).href;
  const added = await runCli(
    project,
    "add",
    source,
    "--all",
    "--copy",
    "--path",
    "published",
    "--yes",
  );
  expect(added.exitCode).toBe(0);
  const lockPath = join(project, "niksi-lock.json");
  const before = await readSkills(lockPath);

  for (const skill of changed) await makeSkill(repo, skill, "version two\n");
  await writeFile(join(repo, "README.md"), "version two\n");
  const upstreamCommit = await commit(repo, "version two");
  await tag(repo, "v1.1.0");
  return { project, lockPath, before, upstreamCommit };
};

const declineUpdate = async (cwd: string, name: string): Promise<RunResult> => {
  const decoder = new TextDecoder();
  let output = "";
  let answered = false;
  const child = Bun.spawn([process.execPath, cli, "update", name], {
    cwd,
    env: {
      ...process.env,
      HOME: tmp,
      NIKSI_HOME: join(tmp, "niksi-home"),
      CI: "1",
      NO_COLOR: "1",
      TERM: "dumb",
    },
    terminal: {
      data(terminal, data) {
        output += decoder.decode(data, { stream: true });
        if (!answered && output.includes(`Update ${name} (project)?`)) {
          answered = true;
          terminal.write("n\r");
        }
      },
    },
  });
  const exitCode = await child.exited;
  child.terminal?.close();
  output += decoder.decode();
  return { exitCode, stdout: output, stderr: "" };
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

  const result = await declineUpdate(fixture.project, "moved");

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
});

test("a moved-only run without selection does not write the lockfile", async () => {
  const fixture = await setupUpdate("moved-only", ["moved"], []);
  const before = await readFile(fixture.lockPath, "utf8");

  const result = await runCli(fixture.project, "update");

  expect(result.exitCode).toBe(2);
  expect(result.stderr).toContain("Pass skill names or --all.");
  expect(await readFile(fixture.lockPath, "utf8")).toBe(before);
});
