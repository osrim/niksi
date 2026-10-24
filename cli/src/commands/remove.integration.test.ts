import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  cliRunner,
  makeSkill,
  terminalRunner,
  type RunCli,
  type RunTerminal,
} from "../test-cli.ts";
import { captureEnv } from "../test-env.ts";

let tmp: string;
let runCli: RunCli;
let runTerminal: RunTerminal;
const restoreEnv = captureEnv("HOME", "NIKSI_HOME");

beforeAll(async () => {
  tmp = await realpath(await mkdtemp(join(tmpdir(), "niksi-remove-cli-test-")));
  process.env.HOME = tmp;
  process.env.NIKSI_HOME = join(tmp, "niksi-home");
  runCli = cliRunner(tmp);
  runTerminal = terminalRunner(tmp);
});

afterAll(async () => {
  restoreEnv();
  await rm(tmp, { recursive: true, force: true });
});

const readLockJson = async (project: string): Promise<Record<string, Record<string, unknown>>> =>
  JSON.parse(await readFile(join(project, "niksi-lock.json"), "utf8")).skills;

const setup = async (name: string): Promise<{ project: string; source: string }> => {
  const project = join(tmp, `${name}-project`);
  const source = join(tmp, `${name}-source`);
  await mkdir(join(project, ".git"), { recursive: true });
  await makeSkill(source, "grilling");
  await makeSkill(source, "wayfinder", "Hand off to /grilling.\n");
  await makeSkill(source, "implement", "Run the `grilling` skill first.\n");
  return { project, source };
};

const addLink = async (project: string, source: string, name: string): Promise<void> => {
  const result = await runCli(project, "add", source, name, "--project", "--agent", "claude", "-y");
  expect(result.exitCode).toBe(0);
};

test("remove names the skills that reference it before the confirm prompt", async () => {
  const { project, source } = await setup("before-confirm");
  for (const name of ["grilling", "wayfinder", "implement"]) await addLink(project, source, name);

  const declined = await runTerminal(
    project,
    [{ on: "Remove grilling (project)?", send: "n\r" }],
    "remove",
    "grilling",
  );

  expect(declined.exitCode).toBe(0);
  const warning = declined.stdout.indexOf("grilling is referenced by implement, wayfinder");
  expect(warning).toBeGreaterThan(-1);
  expect(warning).toBeLessThan(declined.stdout.indexOf("Remove grilling (project)?"));
  expect(Object.keys(await readLockJson(project)).toSorted()).toEqual([
    "grilling",
    "implement",
    "wayfinder",
  ]);
});

test("remove -y warns and proceeds", async () => {
  const { project, source } = await setup("yes");
  await addLink(project, source, "grilling");
  await addLink(project, source, "wayfinder");

  const removed = await runCli(project, "remove", "grilling", "-y");

  expect(removed.exitCode).toBe(0);
  expect(removed.stdout).toContain("grilling is referenced by wayfinder");
  expect(removed.stdout).toContain("grilling: removed");
  expect(existsSync(join(project, ".claude", "skills", "grilling"))).toBe(false);
  expect(Object.keys(await readLockJson(project))).toEqual(["wayfinder"]);
});

test("remove stays quiet when nothing references the skill", async () => {
  const { project, source } = await setup("quiet");
  await addLink(project, source, "grilling");
  await addLink(project, source, "wayfinder");

  const removed = await runCli(project, "remove", "wayfinder", "-y");

  expect(removed.exitCode).toBe(0);
  expect(removed.stdout).not.toContain("is referenced by");
  expect(Object.keys(await readLockJson(project))).toEqual(["grilling"]);
});

test("remove counts a disabled referrer", async () => {
  const { project, source } = await setup("disabled-referrer");
  await addLink(project, source, "grilling");
  await addLink(project, source, "wayfinder");
  expect((await runCli(project, "disable", "wayfinder", "-y")).exitCode).toBe(0);

  const removed = await runCli(project, "remove", "grilling", "-y");

  expect(removed.exitCode).toBe(0);
  expect(removed.stdout).toContain("grilling is referenced by wayfinder");
  expect(await readLockJson(project)).toEqual({
    wayfinder: expect.objectContaining({ disabled: true }),
  });
});

test("removing a skill together with its referrers warns about neither", async () => {
  const { project, source } = await setup("batch");
  await makeSkill(source, "grilling", "Back to /wayfinder.\n");
  for (const name of ["grilling", "wayfinder", "implement"]) await addLink(project, source, name);

  const removed = await runCli(project, "remove", "grilling", "wayfinder", "implement", "-y");

  expect(removed.exitCode).toBe(0);
  expect(removed.stdout).not.toContain("is referenced by");
  expect(await readLockJson(project)).toEqual({});
});

test("remove catches a referrer installed from another source", async () => {
  const { project, source } = await setup("cross-source");
  const other = join(tmp, "cross-source-other");
  await makeSkill(other, "planner", "Then use /grilling.\n");
  await addLink(project, source, "grilling");
  await addLink(project, other, "planner");

  const removed = await runCli(project, "remove", "grilling", "-y");

  expect(removed.exitCode).toBe(0);
  expect(removed.stdout).toContain("grilling is referenced by planner");
  expect(Object.keys(await readLockJson(project))).toEqual(["planner"]);
});
