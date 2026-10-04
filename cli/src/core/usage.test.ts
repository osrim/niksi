import { expect, test } from "bun:test";
import { USAGE_ERROR, usageError } from "./usage.ts";

test("a usage error carries the name the entry point maps to exit 2", () => {
  const error = usageError("Pass either -g or -p, not both.");

  expect(error).toBeInstanceOf(Error);
  expect(error.name).toBe(USAGE_ERROR);
  expect(error.message).toBe("Pass either -g or -p, not both.");
});
