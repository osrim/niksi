import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

const WARN_PROMPT = "Continue with warned and 1 warn finding(s)?";
const DOWN = "\u001b[B";

beforeAll(async () => {
  tmp = await realpath(await mkdtemp(join(tmpdir(), "niksi-gate-cli-test-")));
  process.env.HOME = tmp;
  process.env.NIKSI_HOME = join(tmp, "niksi-home");
  runCli = cliRunner(tmp);
  runTerminal = terminalRunner(tmp);
});

afterAll(async () => {
  restoreEnv();
  await rm(tmp, { recursive: true, force: true });
});

const project = async (name: string, risky: { name: string; file: string }): Promise<string> => {
  const root = join(tmp, name);
  await mkdir(join(root, ".git"), { recursive: true });
  await makeSkill(join(root, "skills"), "clean");
  await makeSkill(join(root, "skills"), risky.name);
  await writeFile(join(root, "skills", risky.name, risky.file), "#!/bin/sh\necho hi\n");
  return root;
};

const warned = async (name: string): Promise<string> => {
  const root = await project(name, { name: "warned", file: "run.sh" });
  await chmod(join(root, "skills", "warned", "run.sh"), 0o755);
  return root;
};

const linked = (root: string, name: string): boolean =>
  existsSync(join(root, ".claude", "skills", name, "SKILL.md"));

const recorded = async (root: string): Promise<string[]> =>
  Object.keys(JSON.parse(await readFile(join(root, "niksi-lock.json"), "utf8")).skills);

const ADD = ["add", "./skills", "--all", "-p", "--agent", "claude"];

test("a warn finding pauses once in a terminal and lands when accepted", async () => {
  const root = await warned("warn-accepted");

  const result = await runTerminal(
    root,
    [
      { on: WARN_PROMPT, send: "\r" },
      { on: "Add clean, warned?", send: "\r" },
    ],
    ...ADD,
  );

  expect(result.exitCode).toBe(0);
  expect(await recorded(root)).toEqual(["clean", "warned"]);
});

test("declining a warn finding skips only that skill", async () => {
  const root = await warned("warn-declined");

  const result = await runTerminal(
    root,
    [
      { on: WARN_PROMPT, send: `${DOWN}\r` },
      { on: "Add clean?", send: "\r" },
    ],
    ...ADD,
  );

  expect(result.exitCode).toBe(0);
  expect(linked(root, "clean")).toBe(true);
  expect(linked(root, "warned")).toBe(false);
  expect(await recorded(root)).toEqual(["clean"]);
});

test("--yes accepts a warn finding without asking", async () => {
  const root = await warned("warn-yes");

  const result = await runTerminal(root, [], ...ADD, "--yes");

  expect(result.exitCode).toBe(0);
  expect(result.stdout).not.toContain(WARN_PROMPT);
  expect(linked(root, "warned")).toBe(true);
});

test("a critical finding without a terminal exits 3 and the rest of the batch lands", async () => {
  const root = await project("critical", { name: "dangerous", file: "hooks.json" });

  const result = await runCli(root, ...ADD, "--yes");

  expect(result.exitCode).toBe(3);
  expect(linked(root, "clean")).toBe(true);
  expect(linked(root, "dangerous")).toBe(false);
  expect(existsSync(join(root, ".niksi", "skills", "dangerous"))).toBe(false);
  expect(await recorded(root)).toEqual(["clean"]);
});
