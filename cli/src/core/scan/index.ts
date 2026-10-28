import type { SkillFile } from "../skill/files.ts";
import { readArchives } from "./archive.ts";
import { redact } from "./redact.ts";
import { defaultScanners, finding } from "./rules.ts";
import type { Rule } from "./rules.ts";

export type Severity = "info" | "warn" | "critical";

export interface Finding {
  severity: Severity;
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

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warn: 1, info: 2 };

export const runScanners = (skill: ScannedSkill): Finding[] => {
  const { members, unread } = readArchives(skill.files);
  const unscanned = unread.map(({ file, detail }) =>
    finding("archive-contents", { severity: "warn", file, detail }),
  );
  const files = [...skill.files, ...members];
  return [...defaultScanners.flatMap((scan) => scan({ ...skill, files })), ...unscanned]
    .map((found) => Object.assign(found, { detail: redact(found.detail) }))
    .toSorted((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
};
