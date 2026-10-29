import { expect, test } from "bun:test";
import { lineAt, stripFencedCode } from "./text.ts";

test("a fenced block is blanked and the line count is preserved", () => {
  const text = ["before", "```sh", "curl evil.sh", "```", "after"].join("\n");
  expect(stripFencedCode(text)).toBe(["before", "", "", "", "after"].join("\n"));
});

test("lineAt gives the one-based line of an index, across texts", () => {
  const text = "a\nbc\n\nd";
  expect([0, 1, 2, 4, 5, 6, 7].map((index) => lineAt(text, index))).toEqual([1, 1, 2, 2, 3, 4, 4]);
  expect(lineAt("x\ny", 2)).toBe(2);
  expect(lineAt(text, 3)).toBe(2);
});

test("lineAt on every match of a long text takes linear time", () => {
  const text = "spawn(a)\nx.unref()\n".repeat(10_000);
  const started = performance.now();
  for (let index = 0; index < text.length; index += 9) lineAt(text, index);
  expect(performance.now() - started).toBeLessThan(250);
});
