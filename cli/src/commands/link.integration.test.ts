import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  realpath,
  rm,
  symlink,
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

let tmp: string;
let runCli: RunCli;
let runTerminal: RunTerminal;
const restoreEnv = captureEnv("HOME", "NIKSI_HOME");

beforeAll(async () => {
  tmp = await realpath(await mkdtemp(join(tmpdir(), "niksi-link-cli-test-")));
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

const readSkills = async (root: string): Promise<Record<string, Record<string, unknown>>> =>
  JSON.parse(await readFile(join(root, "niksi-lock.json"), "utf8")).skills;

const addLink = async (root: string, name: string): Promise<void> => {
  const result = await runCli(root, "add", `./skills/${name}`, "-p", "--agent", "claude", "--yes");
  expect(result.exitCode).toBe(0);
};

const isLink = async (path: string): Promise<boolean> =>
  (await lstat(path).catch(() => null))?.isSymbolicLink() ?? false;

test("add with flags writes a link, a canonical copy, and a lockfile entry", async () => {
  const root = await project("flags", "demo");

  const result = await runCli(root, "add", "./skills/demo", "-p", "--agent", "claude", "--yes");

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(await readlink(join(root, ".claude", "skills", "demo"))).toBe("../../.niksi/skills/demo");
  expect(await readFile(join(root, ".niksi", "skills", "demo", "SKILL.md"), "utf8")).toContain(
    "name: demo",
  );
  const { demo } = await readSkills(root);
  expect(demo).toEqual({
    source: "local:./skills/demo",
    path: "",
    integrity: expect.stringMatching(/^sha256-/u),
    track: "auto",
  });
});

test("prompted add asks for the scope and the agents, then links", async () => {
  const root = await project("prompted", "demo");

  const result = await runTerminal(
    root,
    [
      { on: "Add where?", send: "\r" },
      { on: "Link to which agents?", send: "\r" },
      { on: "Add demo?", send: "\r" },
    ],
    "add",
    "./skills/demo",
  );

  expect(result.exitCode).toBe(0);
  expect(await isLink(join(root, ".claude", "skills", "demo"))).toBe(true);
  expect(Object.keys(await readSkills(root))).toEqual(["demo"]);
});

test("add --copy with an agent records the agents and no copyPath", async () => {
  const root = await project("agent-copy", "demo");

  const result = await runCli(
    root,
    "add",
    "./skills/demo",
    "--copy",
    "-p",
    "--agent",
    "claude",
    "--yes",
  );

  expect(result.exitCode).toBe(0);
  const target = join(root, ".claude", "skills", "demo");
  expect((await lstat(target)).isDirectory()).toBe(true);
  expect(await readFile(join(target, "SKILL.md"), "utf8")).toContain("name: demo");
  expect(existsSync(join(root, ".niksi", "skills", "demo"))).toBe(false);
  const { demo } = await readSkills(root);
  expect(demo).toMatchObject({ copy: true, agents: ["claude"] });
  expect(demo).not.toHaveProperty("copyPath");
});

test("add of a pinned @ref from a Git source records track pin", async () => {
  const root = await project("pinned");
  const repo = join(tmp, "pinned-source");
  await makeSkill(repo, "demo", "version one\n");
  await initRepo(repo);
  const first = await commitAll(repo, "version one");
  await tagHead(repo, "v1.0.0");
  await makeSkill(repo, "demo", "version two\n");
  await commitAll(repo, "version two");

  const result = await runCli(
    root,
    "add",
    `${pathToFileURL(repo).href}@v1.0.0`,
    "demo",
    "-p",
    "--agent",
    "claude",
    "--yes",
  );

  expect(result.exitCode).toBe(0);
  const { demo } = await readSkills(root);
  expect(demo).toMatchObject({
    source: pathToFileURL(repo).href,
    path: "demo",
    commit: first,
    track: "pin",
    pinnedAs: "v1.0.0",
  });
  expect(await readFile(join(root, ".claude", "skills", "demo", "SKILL.md"), "utf8")).toContain(
    "version one",
  );
});

test("remove deletes the link, the canonical copy, and the entry, and nothing else", async () => {
  const root = await project("remove-one", "demo", "other");
  await addLink(root, "demo");
  await addLink(root, "other");
  await writeFile(join(root, ".claude", "skills", "notes.md"), "mine\n");

  const result = await runCli(root, "remove", "demo", "--yes");

  expect(result.exitCode).toBe(0);
  expect(existsSync(join(root, ".claude", "skills", "demo"))).toBe(false);
  expect(existsSync(join(root, ".niksi", "skills", "demo"))).toBe(false);
  expect(Object.keys(await readSkills(root))).toEqual(["other"]);
  expect(await isLink(join(root, ".claude", "skills", "other"))).toBe(true);
  expect(await readFile(join(root, ".claude", "skills", "notes.md"), "utf8")).toBe("mine\n");
});

test("remove --all deletes every link entry", async () => {
  const root = await project("remove-all", "demo", "other");
  await addLink(root, "demo");
  await addLink(root, "other");

  const result = await runCli(root, "remove", "--all", "--yes");

  expect(result.exitCode).toBe(0);
  expect(await readSkills(root)).toEqual({});
  for (const name of ["demo", "other"]) {
    expect(existsSync(join(root, ".claude", "skills", name))).toBe(false);
    expect(existsSync(join(root, ".niksi", "skills", name))).toBe(false);
  }
});

test("remove does not delete a link that niksi did not create", async () => {
  const root = await project("remove-unmanaged", "demo");
  await addLink(root, "demo");
  const link = join(root, ".claude", "skills", "demo");
  const elsewhere = join(root, "elsewhere");
  await makeSkill(root, "elsewhere");
  await rm(link);
  await symlink(elsewhere, link);

  const result = await runCli(root, "remove", "demo", "--yes");

  expect(result.exitCode).toBe(0);
  expect(await readlink(link)).toBe(elsewhere);
  expect(await readFile(join(elsewhere, "SKILL.md"), "utf8")).toContain("name: elsewhere");
  expect(await readSkills(root)).toEqual({});
});

test("list --json reports link and agent-copy entries, modified and missing", async () => {
  const root = await project("list", "linked", "copied");
  await addLink(root, "linked");
  const copied = await runCli(
    root,
    "add",
    "./skills/copied",
    "--copy",
    "-p",
    "--agent",
    "claude",
    "--yes",
  );
  expect(copied.exitCode).toBe(0);
  await writeFile(join(root, ".niksi", "skills", "linked", "SKILL.md"), "edited\n");
  await rm(join(root, ".claude", "skills", "copied"), { recursive: true });

  const human = await runCli(root, "list");
  expect(human.exitCode).toBe(0);
  const json = await runCli(root, "list", "--json");

  expect(json.exitCode).toBe(0);
  expect(json.stderr).toBe("");
  const listed = JSON.parse(json.stdout);
  expect(listed).toMatchObject({ scope: "project", lockfile: join(root, "niksi-lock.json") });
  const [copiedRow, linkedRow] = listed.skills;
  expect(linkedRow).toEqual({
    name: "linked",
    source: "local:./skills/linked",
    path: "",
    integrity: expect.stringMatching(/^sha256-/u),
    track: "auto",
    modified: true,
    agents: ["claude"],
    links: [join(root, ".claude", "skills", "linked")],
  });
  expect(copiedRow).toEqual({
    name: "copied",
    source: "local:./skills/copied",
    path: "",
    integrity: expect.stringMatching(/^sha256-/u),
    track: "auto",
    copy: true,
    agents: [],
    modified: false,
    links: [],
  });
});
