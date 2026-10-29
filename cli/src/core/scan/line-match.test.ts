import { expect, test } from "bun:test";
import { oncePerLine, strongestLine, type LineMatch } from "./line-match.ts";

const match = (line: number, index: number, text: string, fields: Partial<LineMatch> = {}) => ({
  severity: "warn" as const,
  line,
  index,
  text,
  quiet: false,
  ...fields,
});

test("oncePerLine keeps the strongest match on each line, the first on a tie, in text order", () => {
  expect(
    oncePerLine([match(1, 5, "b"), match(2, 9, "c"), match(1, 0, "a")]).map(({ text }) => text),
  ).toEqual(["a", "c"]);
  expect(
    oncePerLine([
      match(1, 0, "a", { severity: "info" }),
      match(1, 4, "b", { severity: "critical" }),
      match(1, 8, "c", { severity: "critical" }),
      match(2, 12, "d"),
    ]).map(({ text }) => text),
  ).toEqual(["b", "d"]);
});

test("strongestLine reports the first strongest match with the match count", () => {
  expect(
    strongestLine([match(1, 0, "a"), match(2, 4, "b", { severity: "critical" }), match(3, 8, "c")]),
  ).toEqual({ severity: "critical", line: 2, detail: "b (3 matches)" });
  expect(strongestLine([match(4, 0, "x", { severity: "info", quiet: true })])?.detail).toBe(
    "x (in a warning)",
  );
  expect(strongestLine([])).toBeUndefined();
});
