import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { cliRunner, commitAll, initRepo, makeSkill, tagHead, type RunCli } from "../test-cli.ts";
import { captureEnv } from "../test-env.ts";

let tmp: string;
let runCli: RunCli;
let project: string;
let repo: string;
let source: string;
let lockPath: string;
let firstCommit: string;
let secondCommit: string;
const restoreEnv = captureEnv("HOME", "NIKSI_HOME");

const LINK = ["-p", "--agent", "claude", "--yes"];

const add = async (cwd: string, ...args: string[]): Promise<void> => {
  const result = await runCli(cwd, "add", ...args, ...LINK);
  expect(result.exitCode).toBe(0);
};

beforeAll(async () => {
  tmp = await realpath(await mkdtemp(join(tmpdir(), "niksi-outdated-cli-test-")));
  process.env.HOME = tmp;
  process.env.NIKSI_HOME = join(tmp, "niksi-home");
  runCli = cliRunner(tmp);

  repo = join(tmp, "source");
  for (const name of ["changed", "moved", "held"]) await makeSkill(repo, name, "version one\n");
  await initRepo(repo);
  firstCommit = await commitAll(repo, "version one");
  await tagHead(repo, "v1.0.0");
  source = pathToFileURL(repo).href;

  project = join(tmp, "project");
  await mkdir(join(project, ".git"), { recursive: true });
  await makeSkill(join(project, "skills"), "mine");
  await add(project, source, "changed", "moved");
  await add(project, `${source}@v1.0.0`, "held");
  await add(project, "./skills/mine");
  lockPath = join(project, "niksi-lock.json");

  for (const name of ["changed", "held"]) await makeSkill(repo, name, "version two\n");
  secondCommit = await commitAll(repo, "version two");
  await tagHead(repo, "v1.1.0");
});

afterAll(async () => {
  restoreEnv();
  await rm(tmp, { recursive: true, force: true });
});

test("outdated --json reports each skill's recorded and upstream revision without a terminal, and exits 1", async () => {
  const before = await readFile(lockPath, "utf8");

  const result = await runCli(project, "outdated", "--json");

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
        name: "held",
        source,
        path: "held",
        track: "pin",
        verdict: "pinned",
        recorded: { commit: firstCommit, pinnedAs: "v1.0.0" },
        upstream: { commit: secondCommit, tag: "v1.1.0", pinnedAs: "v1.1.0" },
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
    ],
    disabled: [],
    blocked: [],
  });
  expect(await readFile(lockPath, "utf8")).toBe(before);
});

test("outdated exits 0 when every checked skill is up to date and names disabled skills without checking them", async () => {
  const local = join(tmp, "local-project");
  await mkdir(join(local, ".git"), { recursive: true });
  for (const name of ["kept", "off"]) {
    await makeSkill(join(local, "skills"), name);
    await add(local, `./skills/${name}`);
  }
  expect((await runCli(local, "disable", "off", "--yes")).exitCode).toBe(0);

  const result = await runCli(local, "outdated", "--json");

  expect(result.exitCode).toBe(0);
  const output = JSON.parse(result.stdout);
  expect(
    output.skills.map(({ name, verdict }: { name: string; verdict: string }) => [name, verdict]),
  ).toEqual([["kept", "up-to-date"]]);
  expect(output.disabled).toEqual(["off"]);
});

test("outdated --json reports an unreachable source with its error and exits 1", async () => {
  const gone = join(tmp, "gone-source");
  await makeSkill(gone, "lost");
  await initRepo(gone);
  await commitAll(gone, "only");
  const lost = join(tmp, "unreachable-project");
  await mkdir(join(lost, ".git"), { recursive: true });
  await add(lost, pathToFileURL(gone).href, "lost");
  await rm(gone, { recursive: true, force: true });

  const result = await runCli(lost, "outdated", "--json");

  expect(result.exitCode).toBe(1);
  const [skill] = JSON.parse(result.stdout).skills;
  expect(skill).toMatchObject({ name: "lost", verdict: "unreachable", upstream: {} });
  expect(skill.error).toEqual(expect.any(String));
});

test("outdated leaves out a skill whose source niksi.json does not allow and exits 3", async () => {
  const guarded = join(tmp, "policy-project");
  await mkdir(join(guarded, ".git"), { recursive: true });
  await add(guarded, source, "changed");
  await writeFile(
    join(guarded, "niksi.json"),
    JSON.stringify({ policy: { sources: { git: ["https://example.com/other.git"] } } }),
  );

  const result = await runCli(guarded, "outdated", "--json");

  expect(result.exitCode).toBe(3);
  const output = JSON.parse(result.stdout);
  expect(output.skills).toEqual([]);
  expect(output.blocked).toEqual(["changed"]);
});

test("outdated without --json lists the skills with updates and exits 1", async () => {
  const result = await runCli(project, "outdated");

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toContain("changed: 1 new commit(s) (v1.0.0 → v1.1.0)");
  expect(result.stdout).toContain("moved: no file changes");
  expect(result.stdout).toContain("held: pinned at v1.0.0. Latest: v1.1.0.");
  expect(result.stdout).toContain("4 skill(s) checked (project): 3 with updates.");
});

test("outdated takes no skill names and exits 2", async () => {
  const result = await runCli(project, "outdated", "changed");

  expect(result.exitCode).toBe(2);
  expect(result.stderr).toContain("nik outdated takes no arguments.");
});
