import * as p from "@clack/prompts";
import type { SkillFile } from "../core/skill/files.ts";
import { asText, parseFrontmatter } from "../core/skill/frontmatter.ts";
import { CRITICAL_EXIT, runScanners, type Finding, type Severity } from "../core/scan/index.ts";
import { ask, clackDecisions, type Decisions } from "./decisions.ts";
import { escapeControl, type PagedSkill } from "./pager.ts";
import { isInteractive, requireTTY } from "./prompt.ts";
import { logError, logFindings, logWarn, renderFiles, warn } from "./report.ts";
import { skillName } from "./style.ts";

type GateOutcome = "pass" | "declined" | "blocked";

export interface ReviewOptions {
  yes?: boolean;
  dangerousSkipCriticalApproval?: boolean;
}

interface Reviewable extends PagedSkill {
  warnings?: string[];
}

interface GateResult<T> {
  approved: T[];
  declined: T[];
  blocked: T[];
}

const FRONTMATTER_KEYS = ["description", "allowed-tools"];

export const renderFrontmatter = (files: SkillFile[]): string[] => {
  const skill = files.find((file) => file.path === "SKILL.md");
  if (!skill) return [];
  let fields: Record<string, unknown>;
  try {
    fields = parseFrontmatter(skill.content.toString("utf8"));
  } catch {
    return [];
  }
  return FRONTMATTER_KEYS.flatMap((key) => {
    const value = fields[key];
    const text = Array.isArray(value) ? value.map(asText).join(", ") : asText(value);
    return text === "" ? [] : [`${key}: ${escapeControl(text)}`];
  });
};

const renderNote = (files: SkillFile[]): string => {
  const frontmatter = renderFrontmatter(files);
  return [...frontmatter, ...(frontmatter.length > 0 ? [""] : []), renderFiles(files)].join("\n");
};

export const reviewSkills = async <T extends Reviewable>(
  selection: T[],
  options: ReviewOptions,
  decisions: Decisions = clackDecisions,
): Promise<GateResult<T>> => {
  const result: GateResult<T> = { approved: [], declined: [], blocked: [] };
  for (const entry of selection) {
    const { name, files } = entry;
    p.note(renderNote(files), `${skillName(name)}: ${files.length} file(s)`);
    for (const warning of entry.warnings ?? []) logWarn(warning);
    const outcome = await reviewSkill(entry, options, decisions);
    if (outcome === "pass") {
      result.approved.push(entry);
    } else {
      result[outcome].push(entry);
      warn(`${skillName(name)}: skipped`);
    }
  }
  return result;
};

export const stopsOn = (
  findings: Finding[],
  { yes, dangerousSkipCriticalApproval }: ReviewOptions,
): Exclude<Severity, "info"> | null => {
  if (!dangerousSkipCriticalApproval && findings.some((finding) => finding.severity === "critical"))
    return "critical";
  if (!yes && findings.some((finding) => finding.severity === "warn")) return "warn";
  return null;
};

const reviewSkill = async (
  entry: PagedSkill,
  options: ReviewOptions,
  decisions: Decisions,
): Promise<GateOutcome> => {
  const findings = runScanners({ name: entry.name, files: entry.files });
  logFindings(entry.name, findings);
  const stop = stopsOn(findings, options);
  if (!stop) return "pass";
  if (!isInteractive()) {
    if (stop === "warn") return "pass";
    logError(`${skillName(entry.name)}: review critical findings in a terminal.`);
    process.exitCode = CRITICAL_EXIT;
    return "blocked";
  }
  const count = findings.filter((finding) => finding.severity === stop).length;
  return (await decisions.approve(entry, stop, count)) ? "pass" : "declined";
};

export const confirmWrite = (
  message: string,
  reviewed: PagedSkill[],
  options: { yes?: boolean | undefined; command: string },
): Promise<boolean> => {
  if (options.yes) return Promise.resolve(true);
  requireTTY(`nik ${options.command} needs confirmation`, "Pass -y to proceed.");
  return ask(message, true, reviewed);
};
