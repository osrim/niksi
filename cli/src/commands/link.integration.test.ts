import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
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
    source: "local:.",
    path: "skills/demo",
    root: "skills/demo",
    integrity: expect.stringMatching(/^sha256-/u),
    track: "auto",
    agents: ["claude"],
  });
});

const listedRow = async (root: string): Promise<Record<string, unknown>> => {
  const listed = await runCli(root, "list", "--json");
  expect(listed.exitCode).toBe(0);
  return JSON.parse(listed.stdout).skills[0];
};

test("both coordinates for one local skill record one source, path, and store entry", async () => {
  const root = await project("coordinates", "demo");
  await addLink(root, "demo");
  const bySkill = (await readSkills(root))["demo"];
  expect(await listedRow(root)).toMatchObject({
    name: "demo",
    source: "local:.",
    path: "skills/demo",
    root: "skills/demo",
  });
  expect((await runCli(root, "remove", "demo", "--yes")).exitCode).toBe(0);

  const result = await runCli(root, "add", "./skills", "demo", "-p", "--agent", "claude", "--yes");

  expect(result.exitCode).toBe(0);
  expect(bySkill).toMatchObject({ source: "local:.", path: "skills/demo", root: "skills/demo" });
  expect((await readSkills(root))["demo"]).toEqual({ ...bySkill, root: "skills" });
  expect(await listedRow(root)).toMatchObject({
    name: "demo",
    source: "local:.",
    path: "skills/demo",
    root: "skills",
  });
  const store = join(tmp, "niksi-home", "store");
  expect(existsSync(join(store, "local_._skills_demo"))).toBe(false);
  expect(existsSync(join(store, "local_._skills"))).toBe(false);
  expect((await readdir(join(store, "local_."))).some((entry) => entry.startsWith("demo@"))).toBe(
    true,
  );
});

test("an entry recorded under the typed directory keeps working", async () => {
  const root = await project("typed-directory", "legacy");
  await addLink(root, "legacy");
  const { legacy } = await readSkills(root);
  const recorded = {
    source: "local:./skills/legacy",
    path: "",
    integrity: legacy!["integrity"],
    track: "auto",
  };
  const lock = `${JSON.stringify({ lockfileVersion: 1, skills: { legacy: recorded } }, null, 2)}\n`;
  await writeFile(join(root, "niksi-lock.json"), lock);
  await rm(join(root, ".niksi"), { recursive: true });
  await rm(join(root, ".claude"), { recursive: true });

  const installed = await runCli(root, "install", "--agent", "claude", "--yes");
  expect(installed.exitCode).toBe(0);
  expect(await isLink(join(root, ".claude", "skills", "legacy"))).toBe(true);

  const added = await runCli(root, "add", "./skills", "legacy", "-p", "--agent", "claude", "--yes");
  expect(added.exitCode).toBe(0);
  expect(await readSkills(root)).toEqual({ legacy: recorded });

  const disabled = await runCli(root, "disable", "./skills", "--yes");
  expect(disabled.exitCode).toBe(0);
  expect(await readSkills(root)).toEqual({
    legacy: { ...recorded, agents: ["claude"], disabled: true },
  });
  expect(existsSync(join(root, ".claude", "skills", "legacy"))).toBe(false);
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

test("list --json reports link and agent-copy entries, installed, modified, and missing", async () => {
  const names = ["linked", "kept", "unlinked", "dangling", "retargeted"];
  const root = await project("list", "copied", ...names);
  for (const name of names) await addLink(root, name);
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
  await writeFile(join(root, ".niksi", "skills", "unlinked", "SKILL.md"), "edited\n");
  await rm(join(root, ".claude", "skills", "unlinked"));
  await rm(join(root, ".niksi", "skills", "dangling"), { recursive: true });
  const retargeted = join(root, ".claude", "skills", "retargeted");
  await rm(retargeted);
  await symlink("../../.niksi/skills/missing", retargeted);

  const human = await runCli(root, "list");
  expect(human.exitCode).toBe(0);
  expect(human.stdout).toContain("4 missing: copied, dangling, retargeted, unlinked");
  const json = await runCli(root, "list", "--json");

  expect(json.exitCode).toBe(0);
  expect(json.stderr).toBe("");
  const listed = JSON.parse(json.stdout);
  expect(listed).toMatchObject({ scope: "project", lockfile: join(root, "niksi-lock.json") });
  const [copiedRow, danglingRow, keptRow, linkedRow, retargetedRow, unlinkedRow] = listed.skills;
  expect(linkedRow).toEqual({
    name: "linked",
    source: "local:.",
    path: "skills/linked",
    root: "skills/linked",
    integrity: expect.stringMatching(/^sha256-/u),
    track: "auto",
    state: "modified",
    modified: true,
    agents: ["claude"],
    links: [join(root, ".claude", "skills", "linked")],
  });
  expect(copiedRow).toEqual({
    name: "copied",
    source: "local:.",
    path: "skills/copied",
    root: "skills/copied",
    integrity: expect.stringMatching(/^sha256-/u),
    track: "auto",
    copy: true,
    agents: [],
    state: "missing",
    modified: false,
    links: [],
  });
  expect(keptRow).toMatchObject({ name: "kept", state: "installed", modified: false });
  expect(unlinkedRow).toMatchObject({ name: "unlinked", state: "missing", modified: true });
  expect(danglingRow).toMatchObject({ name: "dangling", state: "missing" });
  expect(retargetedRow).toMatchObject({
    name: "retargeted",
    state: "missing",
    modified: false,
    agents: ["claude"],
  });
});

test("add of owner/repo/<path> that discovery skips installs that skill rooted at the path", async () => {
  const forge = "https://github.com/o/hidden-skills";
  const repo = join(tmp, "hidden-skills");
  await makeSkill(join(repo, "cursor-plugin", "skills"), "x");
  await makeSkill(join(repo, "plugin", "skills"), "x");
  await makeSkill(join(repo, ".claude", "skills"), "x", "Hidden copy.\n");
  await initRepo(repo);
  await commitAll(repo, "init");
  const shorthand = await project("hidden-shorthand");
  const forgeProject = await project("hidden-forge");
  const restore = captureEnv("GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0");
  process.env.GIT_CONFIG_COUNT = "1";
  process.env.GIT_CONFIG_KEY_0 = `url.${pathToFileURL(repo).href}.insteadOf`;
  process.env.GIT_CONFIG_VALUE_0 = forge;
  try {
    const flags = ["-p", "--agent", "claude", "--yes"];
    const added = await runCli(shorthand, "add", "o/hidden-skills/.claude/skills/x", ...flags);
    expect(added.exitCode).toBe(0);
    const { x } = await readSkills(shorthand);
    expect(x).toMatchObject({
      source: forge,
      path: ".claude/skills/x",
      root: ".claude/skills/x",
      track: "auto",
    });
    const linked = join(shorthand, ".claude", "skills", "x", "SKILL.md");
    expect(await readFile(linked, "utf8")).toContain("Hidden copy.");
    const listed = await runCli(shorthand, "list", "--json");
    expect(listed.exitCode).toBe(0);
    expect(JSON.parse(listed.stdout).skills).toEqual([
      expect.objectContaining({ name: "x", path: ".claude/skills/x", root: ".claude/skills/x" }),
    ]);

    const viaForge = await runCli(
      forgeProject,
      "add",
      `${forge}/tree/main/.claude/skills/x`,
      ...flags,
    );
    expect(viaForge.exitCode).toBe(0);
    expect((await readSkills(forgeProject)).x).toEqual(x!);

    await rm(join(shorthand, ".claude", "skills", "x"));
    const installed = await runCli(shorthand, "install");
    expect(installed.exitCode).toBe(0);
    expect(await readFile(linked, "utf8")).toContain("Hidden copy.");

    await makeSkill(join(repo, ".claude", "skills"), "x", "Hidden copy, version two.\n");
    const upstream = await commitAll(repo, "version two");
    const updated = await runCli(shorthand, "update", "--all", "--yes");
    expect(updated.exitCode).toBe(0);
    expect((await readSkills(shorthand)).x).toMatchObject({
      commit: upstream,
      path: ".claude/skills/x",
      root: ".claude/skills/x",
    });
    expect(await readFile(linked, "utf8")).toContain("version two");
  } finally {
    restore();
  }
});

const freshSource = async (name: string): Promise<{ repo: string; commit: string }> => {
  const repo = join(tmp, name);
  await makeSkill(repo, "demo", "version one\n");
  await initRepo(repo);
  const commit = await commitAll(repo, "version one", Math.floor(Date.now() / 1000) - 86_400);
  await tagHead(repo, "v2.0.0");
  return { repo, commit };
};

const expectInstalledRelease = async (root: string, commit: string): Promise<void> => {
  expect(await readFile(join(root, ".niksi", "skills", "demo", "SKILL.md"), "utf8")).toContain(
    "version one",
  );
  expect(await readlink(join(root, ".claude", "skills", "demo"))).toBe("../../.niksi/skills/demo");
  const { demo } = await readSkills(root);
  expect(demo).toMatchObject({ commit });
  expect(await listedRow(root)).toMatchObject({
    ...demo,
    name: "demo",
    modified: false,
    agents: ["claude"],
  });
};

test("add installs a release inside the cooldown and warns with its age", async () => {
  const root = await project("cooldown-add");
  const { repo, commit } = await freshSource("cooldown-add-source");

  const result = await runCli(
    root,
    "add",
    pathToFileURL(repo).href,
    "-p",
    "--agent",
    "claude",
    "--yes",
  );

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("v2.0.0 is 1 day old, inside the 3-day cooldown.");
  expect((await readSkills(root)).demo).toMatchObject({ commit, track: "auto", tag: "v2.0.0" });
  await expectInstalledRelease(root, commit);
});

test("add warns with the cooldown from niksi.json, and --min-release-age overrides it", async () => {
  const { repo, commit } = await freshSource("project-cooldown-source");
  const add = async (name: string, ...flags: string[]) => {
    const root = await project(name);
    await writeFile(join(root, "niksi.json"), '{"minimumReleaseAge":5}\n');
    const result = await runCli(
      root,
      "add",
      pathToFileURL(repo).href,
      "-p",
      "--agent",
      "claude",
      "--yes",
      ...flags,
    );
    return { root, result };
  };
  const expectInstalled = async (root: string): Promise<void> => {
    const link = join(root, ".claude", "skills", "demo");
    expect(await isLink(link)).toBe(true);
    expect(await readFile(join(link, "SKILL.md"), "utf8")).toContain("version one");
    const { demo } = await readSkills(root);
    expect(demo).toMatchObject({ commit, track: "auto", tag: "v2.0.0", agents: ["claude"] });
    expect(await listedRow(root)).toMatchObject({ ...demo, name: "demo", links: [link] });
  };

  const longer = await add("project-cooldown");
  const off = await add("project-cooldown-off", "--min-release-age", "0");

  expect(longer.result.exitCode).toBe(0);
  expect(longer.result.stdout).toContain("v2.0.0 is 1 day old, inside the 5-day cooldown.");
  await expectInstalled(longer.root);
  expect(off.result.exitCode).toBe(0);
  expect(off.result.stdout).not.toContain("day cooldown");
  await expectInstalled(off.root);
});

test("an invalid niksi.json stops add in project scope, and global scope ignores it", async () => {
  const { repo } = await freshSource("invalid-project-config-source");
  const root = await project("invalid-project-config");
  await writeFile(join(root, "niksi.json"), '{"policy":{"source":{}}}\n');
  const add = (scope: string) =>
    runCli(root, "add", pathToFileURL(repo).href, scope, "--agent", "claude", "--yes");

  const projectRun = await add("-p");
  expect(projectRun.exitCode).toBe(2);
  expect(projectRun.stderr).toContain(`${join(root, "niksi.json")}: unknown key policy.source`);
  expect(existsSync(join(root, "niksi-lock.json"))).toBe(false);

  const globalRun = await add("-g");
  expect(globalRun.exitCode).toBe(0);
  expect(globalRun.stdout).toContain("v2.0.0 is 1 day old, inside the 3-day cooldown.");
});

test("add does not warn with --min-release-age 0 or an explicit ref", async () => {
  const { repo, commit } = await freshSource("quiet-release-source");
  const offRoot = await project("cooldown-off");
  const pinnedRoot = await project("cooldown-ref");
  const off = await runCli(
    offRoot,
    "add",
    pathToFileURL(repo).href,
    "-p",
    "--agent",
    "claude",
    "--yes",
    "--min-release-age",
    "0",
  );
  const pinned = await runCli(
    pinnedRoot,
    "add",
    `${pathToFileURL(repo).href}@v2.0.0`,
    "-p",
    "--agent",
    "claude",
    "--yes",
  );

  for (const result of [off, pinned]) {
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain("day cooldown");
  }
  for (const root of [offRoot, pinnedRoot]) await expectInstalledRelease(root, commit);
});

const clonedRepos = (): Promise<string[]> =>
  readdir(join(tmp, ".cache", "niksi", "repos")).catch(() => []);

test("add exits 1 before it fetches a source that niksi.json does not allow", async () => {
  const { repo } = await freshSource("policy-denied-add-source");
  const root = await project("policy-denied-add");
  await writeFile(join(root, "niksi.json"), '{"policy":{"sources":{"github":["osrim"]}}}\n');

  const denied = await runCli(
    root,
    "add",
    pathToFileURL(repo).href,
    "-p",
    "--agent",
    "claude",
    "--yes",
  );

  expect(denied.exitCode).toBe(1);
  expect(existsSync(join(root, "niksi-lock.json"))).toBe(false);
  expect(existsSync(join(root, ".niksi"))).toBe(false);
  expect((await clonedRepos()).some((dir) => dir.includes("policy_denied_add_source"))).toBe(false);
});

test("add writes a skill from a source that niksi.json allows", async () => {
  const { repo, commit } = await freshSource("policy-allowed-add-source");
  const root = await project("policy-allowed-add");
  const source = pathToFileURL(repo).href;
  await writeFile(
    join(root, "niksi.json"),
    JSON.stringify({ policy: { sources: { git: [source] } } }),
  );

  const result = await runCli(root, "add", source, "-p", "--agent", "claude", "--yes");

  expect(result.exitCode).toBe(0);
  expect((await readSkills(root)).demo).toMatchObject({ source, commit });
  expect(await readFile(join(root, ".claude", "skills", "demo", "SKILL.md"), "utf8")).toContain(
    "version one",
  );
});

const warnSource = async (name: string): Promise<string> => {
  const repo = join(tmp, name);
  await makeSkill(repo, "scripted");
  await writeFile(join(repo, "scripted", "run.sh"), "echo hi\n", { mode: 0o755 });
  await initRepo(repo);
  await commitAll(repo, "scripted");
  return pathToFileURL(repo).href;
};

test("with denyWarn, add --yes refuses a skill with a warn finding and exits 3", async () => {
  const source = await warnSource("deny-warn-add-source");
  const add = async (name: string, config: string) => {
    const root = await project(name);
    await writeFile(join(root, "niksi.json"), config);
    return { root, result: await runCli(root, "add", source, "-p", "--agent", "claude", "--yes") };
  };

  const denied = await add("deny-warn-add", '{"policy":{"denyWarn":true}}');
  const allowed = await add("deny-warn-off-add", '{"policy":{"denyWarn":false}}');

  expect(denied.result.exitCode).toBe(3);
  expect(existsSync(join(denied.root, "niksi-lock.json"))).toBe(false);
  expect(await isLink(join(denied.root, ".claude", "skills", "scripted"))).toBe(false);
  expect(allowed.result.exitCode).toBe(0);
  expect(Object.keys(await readSkills(allowed.root))).toEqual(["scripted"]);
  expect(existsSync(join(allowed.root, ".claude", "skills", "scripted", "run.sh"))).toBe(true);
});
