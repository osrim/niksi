import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pkg from "../../package.json" with { type: "json" };
import { cliRunner, makeSkill, type RunCli } from "../test-cli.ts";
import { captureEnv } from "../test-env.ts";

let tmp: string;
let root: string;
let runCli: RunCli;
const restoreEnv = captureEnv("HOME", "NIKSI_HOME");

beforeAll(async () => {
  tmp = await realpath(await mkdtemp(join(tmpdir(), "niksi-usage-cli-test-")));
  process.env.HOME = tmp;
  process.env.NIKSI_HOME = join(tmp, "niksi-home");
  runCli = cliRunner(tmp);
  root = join(tmp, "project");
  await mkdir(join(root, ".git"), { recursive: true });
  await makeSkill(join(root, "skills"), "demo");
  await makeSkill(join(root, "skills"), "other");
  for (const name of ["demo", "other"]) {
    const added = await runCli(root, "add", `./skills/${name}`, "-p", "--agent", "claude", "-y");
    expect(added.exitCode).toBe(0);
  }
});

afterAll(async () => {
  restoreEnv();
  await rm(tmp, { recursive: true, force: true });
});

test("--version prints the version, platform, and Bun version", async () => {
  const result = await runCli(root, "--version");

  expect(result.exitCode).toBe(0);
  expect(result.stdout.trim()).toBe(
    `nik/${pkg.version} ${process.platform}-${process.arch} bun-v${Bun.version}`,
  );
});

test("--help lists every command", async () => {
  const result = await runCli(root, "--help");

  expect(result.exitCode).toBe(0);
  for (const command of [
    "add",
    "install",
    "update",
    "remove",
    "list",
    "audit",
    "disable",
    "enable",
    "prune",
  ]) {
    expect(result.stdout).toMatch(new RegExp(`^\\s+${command}\\b`, "mu"));
  }
});

test.each([
  {
    args: ["isntall"],
    message: "Unknown command: isntall\nDid you mean `nik install`?",
  },
  {
    args: ["frobnicate"],
    message: "Unknown command: frobnicate\nRun `nik --help` for the command list.",
  },
  { args: ["list", "-g", "-p"], message: "Pass either -g or -p, not both." },
  {
    args: ["add", "./skills/demo", "-p", "--agent", "nope", "-y"],
    message: "Unknown agent(s): nope",
  },
  { args: ["install", "demo"], message: "nik install takes no arguments." },
  { args: ["prune", "-g"], message: "Unknown option `-g`" },
])("$args exits 2 with a usage message", async ({ args, message }) => {
  const lock = await readFile(join(root, "niksi-lock.json"), "utf8");

  const result = await runCli(root, ...args);

  expect(result.exitCode).toBe(2);
  expect(result.stderr).toContain(message);
  expect(await readFile(join(root, "niksi-lock.json"), "utf8")).toBe(lock);
});

test.each([
  {
    args: ["remove"],
    message: "nik remove needs to know which skills, and there is no terminal to ask.",
  },
  {
    args: ["remove", "demo"],
    message: "nik remove needs confirmation, and there is no terminal to ask.",
  },
])("a prompt without a terminal or a flag exits 2: $args", async ({ args, message }) => {
  const result = await runCli(root, ...args);

  expect(result.exitCode).toBe(2);
  expect(result.stderr).toContain(message);
  expect(existsSync(join(root, ".claude", "skills", "demo"))).toBe(true);
});

test("add without --yes and without a terminal writes nothing and exits 2", async () => {
  const fresh = join(tmp, "unconfirmed");
  await mkdir(join(fresh, ".git"), { recursive: true });
  await makeSkill(join(fresh, "skills"), "demo");

  const result = await runCli(fresh, "add", "./skills/demo", "-p", "--agent", "claude");

  expect(result.exitCode).toBe(2);
  expect(result.stderr).toContain("nik add needs confirmation");
  expect(existsSync(join(fresh, "niksi-lock.json"))).toBe(false);
  expect(existsSync(join(fresh, ".claude", "skills", "demo"))).toBe(false);
});
