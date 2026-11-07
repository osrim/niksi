import { describe, expect, test } from "bun:test";
import { USAGE_ERROR } from "../usage.ts";
import {
  checkReleaseAgeArgs,
  describeAge,
  describeWaiting,
  minReleaseAge,
  waitsForCooldown,
} from "./release-age.ts";

const HOUR = 3600;
const DAY = 24 * HOUR;

describe("minReleaseAge", () => {
  test("without the flag, the cooldown is 3 days", () => {
    expect(minReleaseAge(undefined)).toBe(3);
  });

  test("without the flag, a project default wins over 3 days", () => {
    expect(minReleaseAge(undefined, 7)).toBe(7);
  });

  test("the flag wins over a project default", () => {
    expect(minReleaseAge(1, 7)).toBe(1);
    expect(minReleaseAge(0, 7)).toBe(0);
  });

  test.each<[unknown]>([[-1], [1.5], ["soon"], [""], [true], [[1, 2]]])(
    "%p is a usage error",
    (value) => {
      expect(() => minReleaseAge(value)).toThrow(
        expect.objectContaining({ name: USAGE_ERROR }) as unknown as Error,
      );
    },
  );
});

describe("checkReleaseAgeArgs", () => {
  test.each([
    [["update", "--min-release-age", "0"]],
    [["update", "--min-release-age=14"]],
    [["update", "--all"]],
    [["update", "--", "--min-release-age", ""]],
  ])("%p passes", (argv) => {
    expect(() => checkReleaseAgeArgs(argv)).not.toThrow();
  });

  test.each([
    [["update", "--min-release-age", ""]],
    [["update", "--min-release-age", " "]],
    [["update", "--min-release-age="]],
    [["update", "--min-release-age", "0x10"]],
    [["update", "--min-release-age", "1e1"]],
  ])("%p is a usage error", (argv) => {
    expect(() => checkReleaseAgeArgs(argv)).toThrow(
      expect.objectContaining({ name: USAGE_ERROR }) as unknown as Error,
    );
  });
});

describe("waitsForCooldown", () => {
  test("a revision younger than the cooldown waits", () => {
    expect(waitsForCooldown(3 * DAY - 1, 3)).toBe(true);
  });

  test("a revision exactly as old as the cooldown does not wait", () => {
    expect(waitsForCooldown(3 * DAY, 3)).toBe(false);
  });

  test("a revision dated in the future waits", () => {
    expect(waitsForCooldown(-HOUR, 3)).toBe(true);
  });

  test("0 days turns the cooldown off", () => {
    expect(waitsForCooldown(0, 0)).toBe(false);
  });
});

test("describeWaiting names the revision, its age, and the cooldown", () => {
  expect(describeWaiting("v2.0.0", DAY)).toBe("v2.0.0 available, 1 day old, waits for cooldown");
});

describe("describeAge", () => {
  test.each([
    [-HOUR, "dated in the future"],
    [0, "less than an hour old"],
    [59 * 60, "less than an hour old"],
    [HOUR, "1 hour old"],
    [5 * HOUR + 59 * 60, "5 hours old"],
    [DAY, "1 day old"],
    [2 * DAY - 1, "1 day old"],
    [12 * DAY, "12 days old"],
  ])("%p seconds reads as %p", (seconds, text) => {
    expect(describeAge(seconds)).toBe(text);
  });
});
