import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { captureEnv } from "../../test-env.ts";
import type { SkillFile } from "../skill/files.ts";
import { integrityOf } from "../skill/integrity.ts";
import { adoptSkill } from "./adopt.ts";
import { emptyLock } from "./lockfile.ts";

let tmp: string;
const restoreEnv = captureEnv("HOME", "NIKSI_HOME");

const skill = (text: string): SkillFile[] => [
  { path: "SKILL.md", content: Buffer.from(text), mode: "100644" },
];
const LOCAL = skill("---\nname: pdf\nmetadata:\n    github-path: pdf\n---\n# PDF\n");
const UPSTREAM = skill("---\nname: pdf\n---\n\n# PDF\n");
const COMMIT = "a".repeat(40);

const writeCopy = async (dir: string, files: SkillFile[]): Promise<void> => {
  await mkdir(dir, { recursive: true });
  for (const file of files) await writeFile(join(dir, file.path), file.content);
};

beforeAll(async () => {
  tmp = await realpath(await mkdtemp(join(tmpdir(), "niksi-adopt-test-")));
  process.env.HOME = tmp;
  process.env.NIKSI_HOME = join(tmp, "niksi-home");
});

afterAll(async () => {
  restoreEnv();
  await rm(tmp, { recursive: true, force: true });
});

const plan = (dirs: string[], upstream?: SkillFile[]) => ({
  name: "pdf",
  source: "https://github.com/acme/skills",
  path: "skills/pdf",
  revision: { commit: COMMIT, branch: "main", track: "auto" as const },
  integrity: integrityOf(upstream ?? LOCAL),
  agents: ["universal" as const, "claude" as const],
  dirs,
  scannedIntegrity: integrityOf(LOCAL),
  ...(upstream ? { skillMd: upstream[0]!.content } : {}),
  acceptedRules: ["curl-pipe-shell"],
});

test("adoptSkill records an agent copy and leaves matching files alone", async () => {
  const dir = join(tmp, "keep", "pdf");
  await writeCopy(dir, LOCAL);
  const lock = emptyLock();
  await adoptSkill(plan([dir]), lock);
  expect(lock.skills["pdf"]).toEqual({
    source: "https://github.com/acme/skills",
    path: "skills/pdf",
    commit: COMMIT,
    branch: "main",
    integrity: integrityOf(LOCAL),
    track: "auto",
    copy: true,
    agents: ["universal", "claude"],
    review: { acceptedRules: ["curl-pipe-shell"] },
  });
  expect(await readFile(join(dir, "SKILL.md"), "utf8")).toBe(LOCAL[0]!.content.toString("utf8"));
});

test("adoptSkill writes the upstream SKILL.md into every copy and keeps every other entry", async () => {
  const dirs = [join(tmp, "rewrite", "a", "pdf"), join(tmp, "rewrite", "b", "pdf")];
  for (const dir of dirs) {
    await writeCopy(dir, LOCAL);
    await mkdir(join(dir, ".git"), { recursive: true });
    await writeFile(join(dir, ".git", "HEAD"), "ref: refs/heads/main\n");
    await mkdir(join(dir, "node_modules", "dep"), { recursive: true });
    await writeFile(join(dir, "node_modules", "dep", "index.js"), "module.exports = 1;\n");
  }
  const lock = emptyLock();
  await adoptSkill({ ...plan(dirs, UPSTREAM), root: "skills" }, lock);
  for (const dir of dirs) {
    expect(await readFile(join(dir, "SKILL.md"), "utf8")).toBe("---\nname: pdf\n---\n\n# PDF\n");
    expect(await readFile(join(dir, ".git", "HEAD"), "utf8")).toBe("ref: refs/heads/main\n");
    expect(existsSync(join(dir, "node_modules", "dep", "index.js"))).toBe(true);
  }
  expect(lock.skills["pdf"]).toMatchObject({ root: "skills", integrity: integrityOf(UPSTREAM) });
});

test("adoptSkill refuses a copy that changed since the scan, and a recorded name", async () => {
  const dir = join(tmp, "changed", "pdf");
  await writeCopy(dir, skill("edited after the scan\n"));
  const lock = emptyLock();
  await expect(adoptSkill(plan([dir], UPSTREAM), lock)).rejects.toThrow(
    "changed since the scan.\nRun nik adopt again.",
  );
  expect(lock.skills["pdf"]).toBeUndefined();

  await writeCopy(dir, LOCAL);
  lock.skills["pdf"] = {
    source: "local:/",
    path: "x",
    integrity: integrityOf(LOCAL),
    track: "auto",
  };
  await expect(adoptSkill(plan([dir]), lock)).rejects.toThrow("already recorded");
});
