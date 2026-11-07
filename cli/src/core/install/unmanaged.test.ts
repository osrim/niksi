import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { captureEnv } from "../../test-env.ts";
import type { SkillFile } from "../skill/files.ts";
import { integrityOf } from "../skill/integrity.ts";
import { skillsDir } from "./agents.ts";
import { linkSkill, writeCanonical } from "./link.ts";
import { emptyLock } from "./lockfile.ts";
import { findUnmanaged } from "./unmanaged.ts";

let tmp: string;
const restoreEnv = captureEnv("HOME", "NIKSI_HOME", "CLAUDE_HOME", "XDG_CONFIG_HOME");

const files = (body: string): SkillFile[] => [
  { path: "SKILL.md", content: Buffer.from(`---\nname: x\n---\n${body}`), mode: "100644" },
];

const writeSkill = async (dir: string, body: string): Promise<void> => {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), files(body)[0]!.content);
};

const claude = (name: string): string => join(skillsDir("global", "claude"), name);
const universal = (name: string): string => join(skillsDir("global", "universal"), name);

beforeAll(async () => {
  tmp = await realpath(await mkdtemp(join(tmpdir(), "niksi-unmanaged-test-")));
  process.env.HOME = tmp;
  process.env.NIKSI_HOME = join(tmp, "niksi-home");
  process.env.CLAUDE_HOME = join(tmp, ".claude");
  process.env.XDG_CONFIG_HOME = join(tmp, ".config");

  await writeSkill(claude("by-hand"), "by hand\n");
  await writeSkill(universal("npx"), "npx\n");
  await mkdir(skillsDir("global", "claude"), { recursive: true });
  await symlink("../../.agents/skills/npx", claude("npx"));
  await writeSkill(claude("twin"), "twin\n");
  await writeSkill(universal("twin"), "twin\n");
  await writeSkill(claude("drift"), "one\n");
  await writeSkill(universal("drift"), "two\n");
  await writeSkill(join(tmp, "dev", "linked"), "dev\n");
  await symlink(join(tmp, "dev", "linked"), claude("linked"));
  await writeSkill(claude("recorded"), "recorded\n");
  await writeCanonical("managed", files("managed\n"), "global");
  await linkSkill("managed", "global", "claude");
  await mkdir(claude("not-a-skill"), { recursive: true });
  await writeSkill(claude(".hidden"), "hidden\n");
  await writeSkill(claude("back\\slash"), "a name the lockfile cannot hold\n");
});

afterAll(async () => {
  restoreEnv();
  await rm(tmp, { recursive: true, force: true });
});

test("findUnmanaged lists skill directories that no lockfile entry or niksi link owns", async () => {
  const lock = emptyLock();
  lock.skills["recorded"] = {
    source: "local:/",
    path: "x",
    integrity: integrityOf(files("recorded\n")),
    track: "auto",
  };
  const { skills, skipped } = await findUnmanaged("global", lock);

  expect(skills.map(({ name, agents, dirs }) => ({ name, agents, dirs }))).toEqual([
    { name: "by-hand", agents: ["claude"], dirs: [claude("by-hand")] },
    { name: "npx", agents: ["universal", "claude"], dirs: [universal("npx")] },
    { name: "twin", agents: ["universal", "claude"], dirs: [universal("twin"), claude("twin")] },
  ]);
  const byHand = skills[0]!;
  expect(byHand.files).toEqual(files("by hand\n"));
  expect(byHand.integrity).toBe(integrityOf(files("by hand\n")));

  expect(skipped).toEqual([
    { name: "drift", reason: "differ", paths: [universal("drift"), claude("drift")] },
    {
      name: "linked",
      reason: "symlink",
      paths: [claude("linked")],
      target: join(tmp, "dev", "linked"),
    },
  ]);
});

test("findUnmanaged finds nothing when no skills directory exists", async () => {
  const restore = captureEnv("HOME", "CLAUDE_HOME");
  process.env.HOME = join(tmp, "empty-home");
  process.env.CLAUDE_HOME = join(tmp, "empty-home", ".claude");
  try {
    expect(await findUnmanaged("global", emptyLock())).toEqual({ skills: [], skipped: [] });
  } finally {
    restore();
  }
});
