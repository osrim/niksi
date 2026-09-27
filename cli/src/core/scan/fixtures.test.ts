import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { Glob } from "bun";
import { MODE_FILE, readDirFiles } from "../skill/files.ts";
import { runScanners, type Finding, type Severity } from "./index.ts";
import { RULES } from "./rules.ts";
import type { Case, Expected } from "./test-fixture.ts";

const UNCLAIMED = "unclaimed";
const RANK: Record<Severity | "none", number> = { none: 0, info: 1, warn: 2, critical: 3 };

const fixtureDir = join(import.meta.dir, "fixtures");
const fixtures = await Promise.all(
  readdirSync(fixtureDir)
    .filter((name) => name.endsWith(".ts"))
    .toSorted()
    .map(async (name) => ({
      rule: name.slice(0, -".ts".length),
      cases: ((await import(join(fixtureDir, name))) as { default: Case[] }).default,
    })),
);

const scanCase = (rule: string, c: Case): Finding[] =>
  runScanners({
    name: "fixture",
    files: [{ path: c.path, content: Buffer.from(c.content), mode: c.mode ?? MODE_FILE }],
  }).filter((f) => rule === UNCLAIMED || f.rule === rule);

const matches = (f: Finding, want: Expected, path: string): boolean =>
  f.severity === want.severity &&
  f.file === (want.file ?? path) &&
  f.line === want.line &&
  (want.detail === undefined || f.detail === want.detail);

const show = (found: Finding[]): string =>
  found.length === 0
    ? "nothing"
    : found.map((f) => `${f.severity} ${f.file}:${f.line ?? "-"} ${f.detail}`).join("; ");

const missing = (c: Case & { fire: Expected[] }, found: Finding[]): Expected[] => {
  const pool = [...found];
  return c.fire.filter((want) => {
    const index = pool.findIndex((f) => matches(f, want, c.path));
    if (index === -1) return true;
    pool.splice(index, 1);
    return false;
  });
};

test("every rule fixture fires and stays silent as stated", () => {
  const failures: string[] = [];
  const rows = [];
  for (const { rule, cases } of fixtures) {
    const row = { rule, fire: 0, silent: 0, known: 0, misses: 0, falsePositives: 0, changed: 0 };
    for (const c of cases) {
      const found = scanCase(rule, c);
      const where = `${rule}: ${c.name}${c.known ? ` (known: ${c.known})` : ""}`;
      if (c.known) row.known++;
      if ("fire" in c) {
        row.fire++;
        const lost = missing(c, found);
        if (lost.length === 0) continue;
        row.misses++;
        failures.push(`${where}: miss. Expected ${JSON.stringify(lost)}, got ${show(found)}`);
        continue;
      }
      row.silent++;
      const highest = Math.max(RANK.none, ...found.map((f) => RANK[f.severity]));
      if (c.known && highest !== RANK[c.silent]) {
        row.changed++;
        failures.push(`${where}: changed from ${c.silent}, update the case: ${show(found)}`);
      } else if (highest > RANK[c.silent]) {
        row.falsePositives++;
        failures.push(`${where}: false positive above ${c.silent}: ${show(found)}`);
      }
    }
    if (rule !== UNCLAIMED && (row.fire === 0 || row.silent === 0)) {
      failures.push(`${rule}: needs at least one fire case and one silent case`);
    }
    rows.push(row);
  }
  for (const rule of Object.keys(RULES)) {
    if (!fixtures.some((fixture) => fixture.rule === rule)) failures.push(`${rule}: no fixture`);
  }
  for (const { rule } of fixtures) {
    if (rule !== UNCLAIMED && !(rule in RULES)) failures.push(`${rule}: not a rule id`);
  }
  console.table(rows);
  expect(failures).toEqual([]);
});

const corpus = join(import.meta.dir, "..", "..", "..", "testdata", "benign-skills");

test("the benign corpus of published skills produces no critical finding", async () => {
  const skills = [...new Glob("*/*/SKILL.md").scanSync(corpus)].map(dirname).toSorted();
  expect(skills).toHaveLength(27);
  const criticals: string[] = [];
  const counts = new Map<string, { rule: string; warn: number; info: number }>();
  for (const skill of skills) {
    const findings = runScanners({
      name: skill,
      files: await readDirFiles(join(corpus, skill)),
    });
    for (const f of findings) {
      if (f.severity === "critical") {
        criticals.push(`${skill}: ${f.rule} ${f.file}:${f.line ?? "-"} ${f.detail}`);
        continue;
      }
      const count = counts.get(f.rule) ?? { rule: f.rule, warn: 0, info: 0 };
      count[f.severity]++;
      counts.set(f.rule, count);
    }
  }
  console.table([...counts.values()].toSorted((a, b) => a.rule.localeCompare(b.rule)));
  expect(criticals).toEqual([]);
});
