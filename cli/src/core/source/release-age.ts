import { usageError } from "../usage.ts";

export const DEFAULT_MIN_RELEASE_AGE = 3;

const HOUR = 3600;
const DAY = 24 * HOUR;
const FLAG = "--min-release-age";
const USAGE = `Pass a whole number of days to ${FLAG}, once. 0 turns it off.`;

export interface Cooldown {
  days: number;
  now: number;
}

// cac reads "" and " " as 0, so a blank value would turn the cooldown off before a command sees it.
// `add` reads the flag only after it asks for the scope, so a repeated flag fails here first.
export const checkReleaseAgeArgs = (argv: string[]): void => {
  const end = argv.indexOf("--");
  const args = end === -1 ? argv : argv.slice(0, end);
  let seen = false;
  for (const [index, arg] of args.entries()) {
    const value = arg.startsWith(`${FLAG}=`) ? arg.slice(FLAG.length + 1) : undefined;
    const given = arg === FLAG ? args[index + 1] : value;
    if (given === undefined) continue;
    if (seen || !/^\d+$/u.test(given)) throw usageError(USAGE);
    seen = true;
  }
};

export const minReleaseAge = (flag: unknown, fallback = DEFAULT_MIN_RELEASE_AGE): number => {
  if (flag === undefined) return fallback;
  // cac parses a numeric value as a number and a repeated option as an array.
  if (typeof flag !== "number" || !Number.isInteger(flag) || flag < 0) throw usageError(USAGE);
  return flag;
};

export const unixNow = (): number => Math.floor(Date.now() / 1000);

export const waitsForCooldown = (age: number, days: number): boolean =>
  days > 0 && age < days * DAY;

const ageText = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? "" : "s"} old`;

export const describeAge = (seconds: number): string => {
  if (seconds < 0) return "dated in the future";
  if (seconds >= DAY) return ageText(Math.floor(seconds / DAY), "day");
  if (seconds >= HOUR) return ageText(Math.floor(seconds / HOUR), "hour");
  return "less than an hour old";
};

export const describeWaiting = (label: string, age: number): string =>
  `${label} available, ${describeAge(age)}, waits for cooldown`;
