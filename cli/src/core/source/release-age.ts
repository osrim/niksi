import { usageError } from "../usage.ts";

export const DEFAULT_MIN_RELEASE_AGE = 3;

const HOUR = 3600;
const DAY = 24 * HOUR;

export interface Cooldown {
  days: number;
  now: number;
}

export const minReleaseAge = (flag: unknown, fallback = DEFAULT_MIN_RELEASE_AGE): number => {
  if (flag === undefined) return fallback;
  // cac parses a numeric value as a number and a repeated option as an array.
  if (typeof flag !== "number" || !Number.isInteger(flag) || flag < 0) {
    throw usageError("Pass a whole number of days to --min-release-age, once. 0 turns it off.");
  }
  return flag;
};

export const unixNow = (): number => Math.floor(Date.now() / 1000);

export const waitsForCooldown = (age: number, days: number): boolean =>
  days > 0 && age < days * DAY;

const count = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? "" : "s"} old`;

export const describeAge = (seconds: number): string => {
  if (seconds >= DAY) return count(Math.floor(seconds / DAY), "day");
  if (seconds >= HOUR) return count(Math.floor(seconds / HOUR), "hour");
  return "less than an hour old";
};
