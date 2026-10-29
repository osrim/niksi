import { expect, test } from "bun:test";
import { gated, lower, lowerConfidence, stronger, strongest } from "./severity.ts";

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

test("a cross-file partner lowers confidence one level, to no lower than low", () => {
  expect(lowerConfidence("high")).toBe("medium");
  expect(lowerConfidence("medium")).toBe("low");
  expect(lowerConfidence("low")).toBe("low");
});

test("only a critical with low confidence gates as warn", () => {
  expect(gated("critical", "low")).toBe("warn");
  expect(gated("critical", "medium")).toBe("critical");
  expect(gated("warn", "low")).toBe("warn");
  expect(gated("info", "low")).toBe("info");
});
