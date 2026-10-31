import { afterAll, beforeAll, expect, test } from "bun:test";
import {
  cp,
  lstat,
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
  expect(result.stdout).not.toContain("\x1b");
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
  expect(result.stdout).not.toContain("\x1b");
});

test.each([
  ["changed", false],
  ["changed", true],
  ["gone", false],
  ["gone", true],
] as const)(
  "a %s local source skips that entry, installs the rest, and exits 1 (shared store: %p)",
  async (state, sharedStore) => {
    const origin = await project(`${state}-origin-${sharedStore}`, "changed", "intact");
    await addLink(origin, "./skills/changed");
    await addLink(origin, "./skills/intact");
    const checkedOut = await checkout(origin, `${state}-checkout-${sharedStore}`);
    const { root } = checkedOut;
    const run = sharedStore ? runCli : checkedOut.run;
    const stored = await readdir(join(tmp, "niksi-home", "store", "local_."));
    expect(stored.some((entry) => entry.startsWith("changed@"))).toBe(true);
    if (state === "changed") await makeSkill(join(root, "skills"), "changed", "tampered\n");
    else await rm(join(root, "skills", "changed"), { recursive: true });
    const lock = await readFile(join(root, "niksi-lock.json"), "utf8");

    const result = await run(root, "install", "--agent", "claude", "--yes");

    expect(result.exitCode).toBe(1);
    expect(await readFile(join(root, "niksi-lock.json"), "utf8")).toBe(lock);
    expect(await isLink(join(root, ".claude", "skills", "intact"))).toBe(true);
    expect(await isLink(join(root, ".claude", "skills", "changed"))).toBe(false);
    expect(await lstat(join(root, ".niksi", "skills", "changed")).catch(() => null)).toBeNull();
  },
);

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

test("a teammate's install restores recorded link agents and picks agents only for the rest", async () => {
  const origin = await project("agents-origin", "recorded", "legacy");
  const added = await runCli(
    origin,
    "add",
    "./skills/recorded",
    "-p",
    "--agent",
    "claude,universal",
    "-y",
  );
  expect(added.exitCode).toBe(0);
  await addLink(origin, "./skills/legacy");
  const lockfile = join(origin, "niksi-lock.json");
  const written = JSON.parse(await readFile(lockfile, "utf8"));
  expect(written.lockfileVersion).toBe(2);
  expect(written.skills.recorded.agents).toEqual(["universal", "claude"]);
  delete written.skills.legacy.agents;
  await writeFile(lockfile, JSON.stringify(written));
  const { root, run } = await checkout(origin, "agents-checkout");
  const lock = await readFile(join(root, "niksi-lock.json"), "utf8");

  const result = await run(root, "install", "--agent", "opencode", "--yes");

  expect(result.exitCode).toBe(0);
  expect(await isLink(join(root, ".claude", "skills", "recorded"))).toBe(true);
  expect(await isLink(join(root, ".agents", "skills", "recorded"))).toBe(true);
  expect(await isLink(join(root, ".opencode", "skills", "recorded"))).toBe(false);
  expect(await isLink(join(root, ".opencode", "skills", "legacy"))).toBe(true);
  expect(await isLink(join(root, ".claude", "skills", "legacy"))).toBe(false);
  expect(await readFile(join(root, "niksi-lock.json"), "utf8")).toBe(lock);
});

test("the next write rewrites a version 1 lockfile as version 2", async () => {
  const root = await project("v1-rewrite", "old", "new");
  await addLink(root, "./skills/old");
  const lockfile = join(root, "niksi-lock.json");
  const written = JSON.parse(await readFile(lockfile, "utf8"));
  delete written.skills.old.agents;
  await writeFile(lockfile, JSON.stringify({ ...written, lockfileVersion: 1 }));

  await addLink(root, "./skills/new");

  const rewritten = JSON.parse(await readFile(lockfile, "utf8"));
  expect(rewritten.lockfileVersion).toBe(2);
  expect(rewritten.skills.old).toEqual(written.skills.old);
  expect(rewritten.skills.new.agents).toEqual(["claude"]);
});
