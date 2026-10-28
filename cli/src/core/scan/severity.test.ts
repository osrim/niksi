import { expect, test } from "bun:test";
import { lower, stronger } from "./severity.ts";

test("critical is stronger than warn, and warn than info", () => {
  expect(stronger("critical", "warn")).toBe(true);
  expect(stronger("warn", "info")).toBe(true);
  expect(stronger("warn", "warn")).toBe(false);
  expect(stronger("info", "critical")).toBe(false);
});

test("lowering drops one level and stops at info", () => {
  expect(lower("critical")).toBe("warn");
  expect(lower("warn")).toBe("info");
  expect(lower("info")).toBe("info");
});
