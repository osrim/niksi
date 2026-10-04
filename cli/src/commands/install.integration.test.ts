import { afterAll, beforeAll, expect, test } from "bun:test";
import { cp, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  cliRunner,
  commitAll,
  initRepo,
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
  tmp = await realpath(await mkdtemp(join(tmpdir(), "niksi-install-cli-test-")));
  process.env.HOME = tmp;
  process.env.NIKSI_HOME = join(tmp, "niksi-home");
  runCli = cliRunner(tmp);
  runTerminal = terminalRunner(tmp);
});

afterAll(async () => {
  restoreEnv();
  await rm(tmp, { recursive: true, force: true });
});

const project = async (name: string, ...skills: string[]): Promise<string> => {
  const root = join(tmp, name);
  await mkdir(join(root, ".git"), { recursive: true });
  for (const skill of skills) await makeSkill(join(root, "skills"), skill);
  return root;
};

const addLink = async (root: string, coordinate: string, ...names: string[]): Promise<void> => {
  const result = await runCli(root, "add", coordinate, ...names, "-p", "--agent", "claude", "-y");
  expect(result.exitCode).toBe(0);
};

const isLink = async (path: string): Promise<boolean> =>
  (await lstat(path).catch(() => null))?.isSymbolicLink() ?? false;

// A checkout carries the lockfile and the in-project sources, never the store or the links.
const checkout = async (from: string, name: string): Promise<{ root: string; run: RunCli }> => {
  const root = join(tmp, name);
  await mkdir(join(root, ".git"), { recursive: true });
  await cp(join(from, "niksi-lock.json"), join(root, "niksi-lock.json"));
  await cp(join(from, "skills"), join(root, "skills"), { recursive: true });
  return { root, run: cliRunner(join(tmp, `${name}-home`)) };
};

test("a fresh checkout installs every entry with --agent claude --yes", async () => {
  const origin = await project("ci-origin", "local");
  const repo = join(tmp, "ci-source");
  await makeSkill(repo, "remote");
  await initRepo(repo);
  await commitAll(repo, "first");
  await addLink(origin, "./skills/local");
  await addLink(origin, pathToFileURL(repo).href, "remote");
  const { root, run } = await checkout(origin, "ci-checkout");
  const lock = await readFile(join(root, "niksi-lock.json"), "utf8");

  const result = await run(root, "install", "--agent", "claude", "--yes");

  expect(result.exitCode).toBe(0);
  for (const name of ["local", "remote"]) {
    expect(await isLink(join(root, ".claude", "skills", name))).toBe(true);
    expect(await readFile(join(root, ".claude", "skills", name, "SKILL.md"), "utf8")).toContain(
      `name: ${name}`,
    );
  }
  expect(await readFile(join(root, "niksi-lock.json"), "utf8")).toBe(lock);
});

test("an integrity mismatch skips that entry, installs the rest, and exits 1", async () => {
  const origin = await project("mismatch-origin", "changed", "intact");
  await addLink(origin, "./skills/changed");
  await addLink(origin, "./skills/intact");
  const { root, run } = await checkout(origin, "mismatch-checkout");
  await makeSkill(join(root, "skills"), "changed", "tampered\n");
  const lock = await readFile(join(root, "niksi-lock.json"), "utf8");

  const result = await run(root, "install", "--agent", "claude", "--yes");

  expect(result.exitCode).toBe(1);
  expect(await readFile(join(root, "niksi-lock.json"), "utf8")).toBe(lock);
  expect(await isLink(join(root, ".claude", "skills", "intact"))).toBe(true);
  expect(await isLink(join(root, ".claude", "skills", "changed"))).toBe(false);
  expect(await lstat(join(root, ".niksi", "skills", "changed")).catch(() => null)).toBeNull();
});

const modifiedLink = async (name: string): Promise<{ root: string; file: string }> => {
  const root = await project(name, "demo");
  await addLink(root, "./skills/demo");
  const file = join(root, ".niksi", "skills", "demo", "SKILL.md");
  await writeFile(file, "local edit\n");
  return { root, file };
};

test("install keeps a modified link skill without a terminal", async () => {
  const { root, file } = await modifiedLink("modified-piped");

  const result = await runCli(root, "install", "--agent", "claude");

  expect(result.exitCode).toBe(1);
  expect(await readFile(file, "utf8")).toBe("local edit\n");
});

test("install asks before restoring a modified link skill in a terminal", async () => {
  const { root, file } = await modifiedLink("modified-terminal");

  const kept = await runTerminal(
    root,
    [{ on: "Restore 1 modified skill(s) from the source?", send: "\r" }],
    "install",
    "--agent",
    "claude",
  );
  expect(kept.exitCode).toBe(1);
  expect(await readFile(file, "utf8")).toBe("local edit\n");

  const restored = await runTerminal(
    root,
    [{ on: "Restore 1 modified skill(s) from the source?", send: "y\r" }],
    "install",
    "--agent",
    "claude",
  );
  expect(restored.exitCode).toBe(0);
  expect(await readFile(file, "utf8")).toContain("name: demo");
});

test("install --yes restores a modified link skill", async () => {
  const { root, file } = await modifiedLink("modified-yes");

  const result = await runCli(root, "install", "--agent", "claude", "--yes");

  expect(result.exitCode).toBe(0);
  expect(await readFile(file, "utf8")).toContain("name: demo");
  expect(await isLink(join(root, ".claude", "skills", "demo"))).toBe(true);
});
