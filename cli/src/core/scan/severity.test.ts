import { expect, test } from "bun:test";
import { lower, stronger, strongest } from "./severity.ts";

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

test("the strongest is the first match at the highest severity", () => {
  const found = [
    { severity: "warn", at: 1 },
    { severity: "critical", at: 2 },
    { severity: "critical", at: 3 },
  ] as const;
  expect(strongest(found)).toEqual({ severity: "critical", at: 2 });
  expect(strongest([])).toBeUndefined();
});
