import type { Confidence, Severity } from "./index.ts";

const STRENGTH: Severity[] = ["info", "warn", "critical"];

export const rank = (severity: Severity): number => STRENGTH.indexOf(severity);

export const stronger = (a: Severity, b: Severity): boolean => rank(a) > rank(b);

export const lower = (severity: Severity): Severity => STRENGTH[Math.max(rank(severity) - 1, 0)]!;

// The first of the strongest wins, so callers pass matches in text order.
export const strongest = <T extends { severity: Severity }>(found: readonly T[]): T | undefined =>
  found.reduce<T | undefined>(
    (best, next) => (!best || stronger(next.severity, best.severity) ? next : best),
    undefined,
  );

const CONFIDENCE: Confidence[] = ["low", "medium", "high"];

export const lowerConfidence = (confidence: Confidence): Confidence =>
  CONFIDENCE[Math.max(CONFIDENCE.indexOf(confidence) - 1, 0)]!;

// The severity a finding shows and gates with.
export const gated = (severity: Severity, confidence: Confidence): Severity =>
  severity === "critical" && confidence === "low" ? "warn" : severity;
