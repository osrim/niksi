import type { Severity } from "./index.ts";

const STRENGTH: Severity[] = ["info", "warn", "critical"];

export const rank = (severity: Severity): number => STRENGTH.indexOf(severity);

export const stronger = (a: Severity, b: Severity): boolean => rank(a) > rank(b);

export const lower = (severity: Severity): Severity => STRENGTH[Math.max(rank(severity) - 1, 0)]!;
