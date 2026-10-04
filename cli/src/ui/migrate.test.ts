import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureEnv } from "../test-env.ts";
import { captureOutput, type CapturedOutput } from "../test-output.ts";
import { migrateIfLegacy } from "./migrate.ts";

const LOCK = '{"lockfileVersion":1,"skills":{}}\n';
const restoreEnv = captureEnv(
  "HOME",
  "NIKSI_HOME",
  "SKI_HOME",
  "XDG_DATA_HOME",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "CLAUDE_HOME",
);
const cwd = process.cwd();
let tmp: string;
let output: CapturedOutput;
let n = 0;

beforeAll(async () => {
  tmp = await realpath(await mkdtemp(join(tmpdir(), "niksi-ui-migrate-test-")));
  process.env.HOME = join(tmp, "home");
  process.env.CLAUDE_HOME = join(tmp, "home", ".claude");
  process.env.XDG_DATA_HOME = join(tmp, "xdg", "data");
  process.env.XDG_CONFIG_HOME = join(tmp, "xdg", "config");
  process.env.XDG_CACHE_HOME = join(tmp, "xdg", "cache");
  delete process.env.NIKSI_HOME;
  delete process.env.SKI_HOME;
});

beforeEach(() => {
  output = captureOutput();
});

afterEach(() => {
  output.restore();
  process.chdir(cwd);
});

afterAll(async () => {
  restoreEnv();
  await rm(tmp, { recursive: true, force: true });
});

const project = async (legacy: boolean): Promise<string> => {
  const root = join(tmp, `p${n++}`);
  await mkdir(join(root, ".git"), { recursive: true });
  if (legacy) await writeFile(join(root, "ski-lock.json"), LOCK);
  process.chdir(root);
  return root;
};

test("no legacy layout prints nothing and moves nothing", async () => {
  const root = await project(false);

  await migrateIfLegacy("project");

  expect(output.text()).toBe("");
  expect(existsSync(join(root, "niksi-lock.json"))).toBe(false);
});

test("a legacy layout is migrated with a notice", async () => {
  const root = await project(true);

  await migrateIfLegacy("project");

  expect(output.text()).toContain("Migration complete");
  expect(await readFile(join(root, "niksi-lock.json"), "utf8")).toBe(LOCK);
  expect(existsSync(join(root, "ski-lock.json"))).toBe(false);
});

test("a silent migration moves the layout without a notice", async () => {
  const root = await project(true);

  await migrateIfLegacy("project", true);

  expect(output.text()).toBe("");
  expect(await readFile(join(root, "niksi-lock.json"), "utf8")).toBe(LOCK);
});
