import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { USAGE_ERROR } from "../usage.ts";
import { describeSelector, parseSourceSelector, selectsSource } from "./selector.ts";

let tmp: string;

beforeAll(async () => {
  tmp = await realpath(await mkdtemp(join(tmpdir(), "niksi-selector-test-")));
});

afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const usageMessage = (raw: string): string => {
  try {
    parseSourceSelector(raw);
  } catch (e) {
    expect((e as Error).name).toBe(USAGE_ERROR);
    return (e as Error).message;
  }
  throw new Error(`${raw} parsed`);
};

test("local selects every local source and no Git source", () => {
  const selector = parseSourceSelector("local");
  expect(selectsSource(selector, `local:${tmp}`)).toBe(true);
  expect(selectsSource(selector, "local:./skills")).toBe(true);
  expect(selectsSource(selector, "https://github.com/o/r")).toBe(false);
  expect(selectsSource(selector, "file:///tmp/local")).toBe(false);
});

test("a GitHub coordinate selects only its repository", () => {
  const selector = parseSourceSelector("o/r");
  expect(selectsSource(selector, "https://github.com/o/r")).toBe(true);
  expect(selectsSource(selector, "https://github.com/o/other")).toBe(false);
  expect(selectsSource(selector, `local:${tmp}`)).toBe(false);
});

test("a Git URL selects the source recorded with that URL", () => {
  const selector = parseSourceSelector("file:///tmp/repo");
  expect(selectsSource(selector, "file:///tmp/repo")).toBe(true);
  expect(selectsSource(selector, "https://github.com/o/r")).toBe(false);
});

test("a local path selects only the local source at that directory", () => {
  const selector = parseSourceSelector(tmp);
  expect(selectsSource(selector, `local:${tmp}`)).toBe(true);
  expect(selectsSource(selector, `local:${join(tmp, "other")}`)).toBe(false);
  expect(selectsSource(selector, `file://${tmp}`)).toBe(false);
});

test("a coordinate that names a skill, a ref, or a forge URL path is a usage error", () => {
  expect(usageMessage("o/r/skills/tdd")).toContain("o/r/skills/tdd");
  expect(usageMessage("o/r@v1.0.0")).toContain("o/r@v1.0.0");
  expect(usageMessage("https://github.com/o/r/tree/main/skills")).toContain("source");
});

test("an invalid coordinate is a usage error", () => {
  expect(usageMessage("not a source")).toContain("local");
  expect(usageMessage("")).toContain("--source");
});

test("a selector reads as the keyword or the repository it matches", () => {
  expect(describeSelector(parseSourceSelector("local"))).toBe("local");
  expect(describeSelector(parseSourceSelector("o/r"))).toBe("https://github.com/o/r");
});
