import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cliRunner, makeSkill, type RunCli } from "../test-cli.ts";
import { captureEnv } from "../test-env.ts";

let tmp: string;
let runCli: RunCli;
const restoreEnv = captureEnv("HOME", "NIKSI_HOME");

beforeAll(async () => {
  tmp = await realpath(await mkdtemp(join(tmpdir(), "niksi-disable-cli-test-")));
  process.env.HOME = tmp;
  process.env.NIKSI_HOME = join(tmp, "niksi-home");
  runCli = cliRunner(tmp);
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
  return { project, source };
};

const addLink = async (project: string, source: string, name: string): Promise<void> => {
  const result = await runCli(project, "add", source, name, "--project", "--agent", "claude", "-y");
  expect(result.exitCode).toBe(0);
};

test("disable removes the link and canonical copy, keeps the entry, and rebuilds the exclude block", async () => {
  const project = join(tmp, "link-project");
  const source = join(tmp, "link-source");
  await mkdir(project, { recursive: true });
  expect((await Bun.$`git init -q ${project}`.quiet()).exitCode).toBe(0);
  await makeSkill(source, "alpha");
  await addLink(project, source, "alpha");
  const exclude = join(project, ".git", "info", "exclude");
  expect(await readFile(exclude, "utf8")).toContain(".claude/skills/alpha");

  const disabled = await runCli(project, "disable", "alpha", "-y");
  expect(disabled.exitCode).toBe(0);
  expect(disabled.stdout).toContain("alpha: disabled");
  expect(existsSync(join(project, ".claude", "skills", "alpha"))).toBe(false);
  expect(existsSync(join(project, ".niksi", "skills", "alpha"))).toBe(false);
  const lock = await readLockJson(project);
  expect(lock["alpha"]).toMatchObject({ disabled: true, path: "alpha" });
  expect(await readFile(exclude, "utf8")).not.toContain(".claude/skills/alpha");

  const enabled = await runCli(project, "enable", "alpha", "-y", "--agent", "claude");
  expect(enabled.exitCode).toBe(0);
  expect(enabled.stdout).toMatch(/alpha: enabled @ \w+/u);
  expect(await readFile(exclude, "utf8")).toContain(".claude/skills/alpha");
});

test("disable with a local source path disables every entry from that source only", async () => {
  const { project, source } = await setup("by-source");
  const other = join(tmp, "by-source-other");
  await makeSkill(source, "alpha");
  await makeSkill(source, "beta");
  await makeSkill(other, "gamma");
  await addLink(project, source, "alpha");
  await addLink(project, source, "beta");
  await addLink(project, other, "gamma");

  const result = await runCli(project, "disable", source, "-y");
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("alpha: disabled");
  expect(result.stdout).toContain("beta: disabled");
  const lock = await readLockJson(project);
  expect(lock["alpha"]!["disabled"]).toBe(true);
  expect(lock["beta"]!["disabled"]).toBe(true);
  expect(lock["gamma"]!["disabled"]).toBeUndefined();
  expect((await lstat(join(project, ".claude", "skills", "gamma"))).isSymbolicLink()).toBe(true);

  const enabled = await runCli(project, "enable", source, "-y", "--agent", "claude");
  expect(enabled.exitCode).toBe(0);
  expect(enabled.stdout).toContain("alpha: enabled");
  expect(enabled.stdout).toContain("beta: enabled");
  expect((await readLockJson(project))["alpha"]!["disabled"]).toBeUndefined();
});

test("list shows a disabled skill as disabled, not missing, and --json carries the flag", async () => {
  const { project, source } = await setup("list");
  await makeSkill(source, "alpha");
  await makeSkill(source, "beta");
  await addLink(project, source, "alpha");
  await addLink(project, source, "beta");
  expect((await runCli(project, "disable", "alpha", "-y")).exitCode).toBe(0);

  const human = await runCli(project, "list");
  expect(human.exitCode).toBe(0);
  expect(human.stdout).toMatch(/alpha\s+\S+\s+disabled/u);
  expect(human.stdout).toContain("2 skill(s) recorded (project); 1 disabled.");
  expect(human.stdout).not.toContain("missing");

  const json = await runCli(project, "list", "--json");
  expect(json.exitCode).toBe(0);
  const rows = JSON.parse(json.stdout).skills;
  const alpha = rows.find((row: { name: string }) => row.name === "alpha");
  expect(alpha.disabled).toBe(true);
  expect(alpha.agents).toEqual([]);
  expect(alpha.links).toEqual([]);
  expect(rows.find((row: { name: string }) => row.name === "beta").disabled).toBeUndefined();
});

test("install restores enabled entries only and reports the disabled ones", async () => {
  const { project, source } = await setup("install");
  await makeSkill(source, "alpha");
  await makeSkill(source, "delta");
  await addLink(project, source, "alpha");
  expect(
    (await runCli(project, "add", source, "delta", "--copy", "--path", "published", "-y")).exitCode,
  ).toBe(0);
  expect((await runCli(project, "disable", "alpha", "-y")).exitCode).toBe(0);
  await rm(join(project, "published", "delta"), { recursive: true });

  const installed = await runCli(project, "install", "-y");
  expect(installed.exitCode).toBe(0);
  expect(installed.stdout).toContain("1 disabled: alpha");
  expect(installed.stdout).toContain("nik enable");
  expect(installed.stdout).not.toContain("Linking to");
  expect(installed.stdout).toContain("Installed 1/1 skill(s)");
  expect(existsSync(join(project, "published", "delta", "SKILL.md"))).toBe(true);
  expect(existsSync(join(project, ".claude", "skills", "alpha"))).toBe(false);
  expect(existsSync(join(project, ".niksi", "skills", "alpha"))).toBe(false);
});

test("update skips a disabled skill and refuses to check it by name", async () => {
  const { project, source } = await setup("update");
  await makeSkill(source, "alpha", "version one\n");
  await makeSkill(source, "beta", "version one\n");
  await addLink(project, source, "alpha");
  await addLink(project, source, "beta");
  expect((await runCli(project, "disable", "alpha", "-y")).exitCode).toBe(0);
  const before = await readFile(join(project, "niksi-lock.json"), "utf8");
  await makeSkill(source, "alpha", "version two\n");
  await makeSkill(source, "beta", "version two\n");

  const all = await runCli(project, "update", "--all", "-y");
  expect(all.exitCode).toBe(0);
  expect(all.stdout).toContain("1 disabled: alpha");
  expect(all.stdout).toContain("beta: updated");
  expect(existsSync(join(project, ".niksi", "skills", "alpha"))).toBe(false);
  const after = await readLockJson(project);
  expect(after["alpha"]).toEqual(JSON.parse(before).skills.alpha);
  expect(after["beta"]!["integrity"]).not.toBe(JSON.parse(before).skills.beta.integrity);

  const named = await runCli(project, "update", "alpha", "-y");
  expect(named.exitCode).toBe(1);
  expect(named.stderr).toContain("alpha: disabled");
  expect(named.stderr).toContain("nik enable alpha");
});

test("enable restores a reviewed skill without a file list, findings, or review", async () => {
  const { project, source } = await setup("enable-critical");
  await makeSkill(source, "risky");
  await writeFile(join(source, "risky", "hooks.json"), "{}\n");
  const added = await runCli(
    project,
    "add",
    source,
    "risky",
    "--project",
    "--agent",
    "claude",
    "-y",
    "--dangerous-skip-critical-approval",
  );
  expect(added.exitCode).toBe(0);
  expect(added.stdout).toContain("critical");
  expect((await runCli(project, "disable", "risky", "-y")).exitCode).toBe(0);

  const enabled = await runCli(project, "enable", "risky", "-y", "--agent", "claude");
  expect(enabled.exitCode).toBe(0);
  expect(enabled.stdout).toContain("risky: enabled");
  expect(enabled.stdout).not.toContain("critical");
  expect(enabled.stdout).not.toContain("hooks.json");
  expect(enabled.stdout).not.toContain("file(s)");
  expect(enabled.stdout).not.toContain("Review files");
  expect((await lstat(join(project, ".claude", "skills", "risky"))).isSymbolicLink()).toBe(true);
  expect(await readFile(join(project, ".niksi", "skills", "risky", "hooks.json"), "utf8")).toBe(
    "{}\n",
  );
  expect((await readLockJson(project))["risky"]!["disabled"]).toBeUndefined();
});

test("disable and enable on the wrong state report it and exit 0", async () => {
  const { project, source } = await setup("already");
  await makeSkill(source, "alpha");
  await addLink(project, source, "alpha");

  const enabled = await runCli(project, "enable", "alpha", "-y");
  expect(enabled.exitCode).toBe(0);
  expect(enabled.stdout).toContain("alpha: already enabled");
  expect(enabled.stdout).toContain("Nothing to enable.");

  expect((await runCli(project, "disable", "alpha", "-y")).exitCode).toBe(0);
  const disabled = await runCli(project, "disable", "alpha", "-y");
  expect(disabled.exitCode).toBe(0);
  expect(disabled.stdout).toContain("alpha: already disabled");
  expect(disabled.stdout).toContain("Nothing to disable.");
});

test("disable without names or a terminal, or with a skill coordinate, exits 2", async () => {
  const { project, source } = await setup("usage");
  await makeSkill(source, "alpha");
  await addLink(project, source, "alpha");

  const picker = await runCli(project, "disable");
  expect(picker.exitCode).toBe(2);
  expect(picker.stderr).toContain("Pass skill names or --all.");

  const coordinate = await runCli(project, "disable", "owner/repo/alpha", "-y");
  expect(coordinate.exitCode).toBe(2);
  expect(coordinate.stderr).toContain("owner/repo/alpha");

  const unknown = await runCli(project, "disable", "owner/repo", "-y");
  expect(unknown.exitCode).toBe(1);
  expect(unknown.stderr).toContain("Not recorded: owner/repo");
  expect((await readLockJson(project))["alpha"]!["disabled"]).toBeUndefined();
});

test("disable warns that a modified skill's edits are discarded", async () => {
  const { project, source } = await setup("modified");
  await makeSkill(source, "alpha");
  await addLink(project, source, "alpha");
  await writeFile(join(project, ".niksi", "skills", "alpha", "SKILL.md"), "local edit\n");

  const disabled = await runCli(project, "disable", "alpha", "-y");
  expect(disabled.exitCode).toBe(0);
  expect(disabled.stdout).toContain("1 skill(s) modified since install: alpha");
  expect(disabled.stdout).toContain("Disabling discards those edits");
  expect(existsSync(join(project, ".niksi", "skills", "alpha"))).toBe(false);
});

test("add holds a disabled skill and names nik enable", async () => {
  const { project, source } = await setup("add-held");
  await makeSkill(source, "alpha");
  await addLink(project, source, "alpha");
  expect((await runCli(project, "disable", "alpha", "-y")).exitCode).toBe(0);

  const added = await runCli(
    project,
    "add",
    source,
    "alpha",
    "--project",
    "--agent",
    "claude",
    "-y",
  );
  expect(added.exitCode).toBe(1);
  expect(added.stderr).toContain("alpha is already disabled");
  expect(added.stderr).toContain("nik enable alpha");
  expect(added.stdout).not.toContain("Review files");
  expect(Object.keys(await readLockJson(project))).toEqual(["alpha"]);
});

test("remove deletes a disabled entry", async () => {
  const { project, source } = await setup("remove");
  await makeSkill(source, "alpha");
  await addLink(project, source, "alpha");
  expect((await runCli(project, "disable", "alpha", "-y")).exitCode).toBe(0);

  const removed = await runCli(project, "remove", "alpha", "-y");
  expect(removed.exitCode).toBe(0);
  expect(removed.stdout).toContain("alpha: removed");
  expect(await readLockJson(project)).toEqual({});
});

test("agent copies and path copies go through a disable and enable cycle", async () => {
  const { project, source } = await setup("copies");
  await makeSkill(source, "gamma");
  await makeSkill(source, "delta");
  expect(
    (
      await runCli(
        project,
        "add",
        source,
        "gamma",
        "--project",
        "--copy",
        "--agent",
        "universal",
        "-y",
      )
    ).exitCode,
  ).toBe(0);
  expect(
    (await runCli(project, "add", source, "delta", "--copy", "--path", "published", "-y")).exitCode,
  ).toBe(0);

  const disabled = await runCli(project, "disable", "--all", "-y");
  expect(disabled.exitCode).toBe(0);
  expect(existsSync(join(project, ".agents", "skills", "gamma"))).toBe(false);
  expect(existsSync(join(project, "published", "delta"))).toBe(false);
  let lock = await readLockJson(project);
  expect(lock["gamma"]).toMatchObject({ copy: true, agents: ["universal"], disabled: true });
  expect(lock["delta"]).toMatchObject({ copy: true, copyPath: "published", disabled: true });

  const enabled = await runCli(project, "enable", "--all", "-y");
  expect(enabled.exitCode).toBe(0);
  expect(enabled.stdout).not.toContain("Linking to");
  expect(enabled.stdout).not.toContain("No agent detected");
  expect((await lstat(join(project, ".agents", "skills", "gamma"))).isDirectory()).toBe(true);
  expect(existsSync(join(project, "published", "delta", "SKILL.md"))).toBe(true);
  lock = await readLockJson(project);
  expect(lock["gamma"]!["disabled"]).toBeUndefined();
  expect(lock["delta"]!["disabled"]).toBeUndefined();
});
