import type { SkillFile } from "../skill/files.ts";
import { readArchives } from "./archive.ts";
import { redact } from "./redact.ts";
import { defaultScanners, finding } from "./rules.ts";
import type { Rule } from "./rules.ts";
import { rank } from "./severity.ts";

export type Severity = "info" | "warn" | "critical";

export type Confidence = "low" | "medium" | "high";

export interface Finding {
  severity: Severity;
  confidence: Confidence;
  rule: Rule;
  help: string;
  file?: string;
  line?: number;
  detail: string;
  accepted?: true;
}

export interface ScannedSkill {
  name: string;
  files: SkillFile[];
}

export type Scanner = (skill: ScannedSkill) => Finding[];

export const CRITICAL_EXIT = 3;

export const criticalRules = (findings: Finding[]): Rule[] =>
  [
    ...new Set(
      findings.filter((found) => found.severity === "critical").map((found) => found.rule),
    ),
  ].toSorted();

export const markAccepted = (findings: Finding[], acceptedRules: readonly string[]): Finding[] =>
  findings.map((found) =>
    found.severity === "critical" && acceptedRules.includes(found.rule)
      ? { ...found, accepted: true }
      : found,
  );

export const runScanners = (skill: ScannedSkill): Finding[] => {
  const { members, unread } = readArchives(skill.files);
  const unscanned = unread.map(({ file, detail }) =>
    finding("archive-contents", { severity: "warn", file, detail }),
  );
  const files = [...skill.files, ...members];
  return [...defaultScanners.flatMap((scan) => scan({ ...skill, files })), ...unscanned]
    .map((found) => Object.assign(found, { detail: redact(found.detail) }))
    .toSorted((a, b) => rank(b.severity) - rank(a.severity));
};
