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
}

export interface ScannedSkill {
  name: string;
  files: SkillFile[];
}

export type Scanner = (skill: ScannedSkill) => Finding[];

export const CRITICAL_EXIT = 3;

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
