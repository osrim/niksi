import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { deleteCandidate, materialize, prunePlan } from "./store.ts";
import { storeDir } from "../paths.ts";
import type { SkillFile } from "../skill/files.ts";
import { captureEnv } from "../../test-env.ts";

const restoreEnv = captureEnv("NIKSI_HOME");
let tmp: string;

const SOURCE = "https://github.com/o/r";
const OTHER = "https://github.com/o/other";

const files = (text: string): SkillFile[] => [
  { path: "SKILL.md", content: Buffer.from(text), mode: "100644" },
  { path: "scripts/run.sh", content: Buffer.from(`echo ${text}`), mode: "100755" },
];

const store = async (source: string, name: string, text: string): Promise<string> =>
  (await materialize(source, name, files(text))).entry;

const pruneAll = async (kept: Set<string>): Promise<void> => {
  for (const candidate of await prunePlan(kept)) await deleteCandidate(candidate);
};

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "niksi-store-test-"));
});

beforeEach(() => {
  process.env.NIKSI_HOME = join(tmp, `home-${Math.random().toString(36).slice(2)}`);
});

afterAll(async () => {
  restoreEnv();
  await rm(tmp, { recursive: true, force: true });
});

test("plan lists unrecorded entries with their sizes and delete keeps recorded ones", async () => {
  const keptA = await store(SOURCE, "a", "a\n");
  const keptB = await store(OTHER, "b", "b\n");
  const oldA = await store(SOURCE, "a", "a-old\n");
  const oldC = await store(SOURCE, "c", "c\n");
  const oldD = await store(OTHER, "d", "d\n");

  const plan = await prunePlan(new Set([keptA, keptB]));

  expect(plan.map((candidate) => candidate.path).toSorted()).toEqual([oldA, oldC, oldD].toSorted());
  const bytes = new Map(plan.map((candidate) => [candidate.path, candidate.bytes]));
  // "a-old\n" is 6 bytes in SKILL.md plus "echo a-old\n" is 11 bytes in scripts/run.sh.
  expect(bytes.get(oldA)).toBe(17);
  expect(bytes.get(oldC)).toBe(2 + 7);

  await pruneAll(new Set([keptA, keptB]));

  expect(existsSync(keptA)).toBe(true);
  expect(existsSync(keptB)).toBe(true);
  expect(existsSync(oldA)).toBe(false);
  expect(existsSync(oldC)).toBe(false);
  expect(existsSync(oldD)).toBe(false);
});

test("a leftover .tmp directory is planned and deleted", async () => {
  const kept = await store(SOURCE, "a", "a\n");
  const leftover = join(storeDir(), "github.com_o_r", "a.tmp");
  await mkdir(leftover, { recursive: true });
  await writeFile(join(leftover, "SKILL.md"), "partial");

  const plan = await prunePlan(new Set([kept]));

  expect(plan).toEqual([{ path: leftover, bytes: 7 }]);

  await pruneAll(new Set([kept]));
  expect(existsSync(leftover)).toBe(false);
  expect(existsSync(kept)).toBe(true);
});

test("an emptied source directory is removed and one that keeps an entry remains", async () => {
  const kept = await store(SOURCE, "a", "a\n");
  await store(SOURCE, "a", "a-old\n");
  await store(OTHER, "b", "b\n");

  await pruneAll(new Set([kept]));

  expect(existsSync(join(storeDir(), "github.com_o_other"))).toBe(false);
  expect(await readdir(join(storeDir(), "github.com_o_r"))).toEqual([basename(kept)]);
});

test("an empty or missing store gives an empty plan", async () => {
  expect(await prunePlan(new Set())).toEqual([]);
  await mkdir(storeDir(), { recursive: true });
  expect(await prunePlan(new Set())).toEqual([]);
});

test("a symlink inside the store is unlinked and its target is untouched", async () => {
  const kept = await store(SOURCE, "a", "a\n");
  const outside = join(tmp, `outside-${Math.random().toString(36).slice(2)}`);
  await mkdir(outside, { recursive: true });
  await writeFile(join(outside, "keep.txt"), "important");
  const inSource = join(storeDir(), "github.com_o_r", "escape");
  const atRoot = join(storeDir(), "escape-root");
  await symlink(outside, inSource);
  await symlink(outside, atRoot);

  const plan = await prunePlan(new Set([kept]));
  expect(plan.map((candidate) => candidate.path).toSorted()).toEqual([inSource, atRoot].toSorted());

  await pruneAll(new Set([kept]));

  expect((await lstat(inSource).catch(() => null)) === null).toBe(true);
  expect((await lstat(atRoot).catch(() => null)) === null).toBe(true);
  expect(existsSync(join(outside, "keep.txt"))).toBe(true);
  expect(existsSync(kept)).toBe(true);
});

test("delete refuses a candidate whose parent resolves outside the store", async () => {
  const outside = join(tmp, `outside-${Math.random().toString(36).slice(2)}`);
  await mkdir(outside, { recursive: true });
  await writeFile(join(outside, "victim.txt"), "keep me");
  await mkdir(storeDir(), { recursive: true });
  // A source directory swapped for a symlink out of the store, racing the plan.
  await symlink(outside, join(storeDir(), "github.com_evil"));
  const candidate = { path: join(storeDir(), "github.com_evil", "victim.txt"), bytes: 0 };

  await expect(deleteCandidate(candidate)).rejects.toThrow();
  expect(existsSync(join(outside, "victim.txt"))).toBe(true);
});
