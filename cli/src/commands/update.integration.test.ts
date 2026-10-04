import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
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
  return { project, lockPath, before, upstreamCommit };
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

test("a moved-only run without selection does not write the lockfile", async () => {
  const fixture = await setupUpdate("moved-only", ["moved"], []);
  const before = await readFile(fixture.lockPath, "utf8");

  const result = await runCli(fixture.project, "update");

  expect(result.exitCode).toBe(2);
  expect(result.stderr).toContain("Pass skill names or --all.");
  expect(await readFile(fixture.lockPath, "utf8")).toBe(before);
});
