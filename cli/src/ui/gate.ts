import * as p from "@clack/prompts";
import type { SkillFile } from "../core/skill/files.ts";
import { asText, parseFrontmatter } from "../core/skill/frontmatter.ts";
import { PROJECT_CONFIG_NAME } from "../core/project-config.ts";
import {
  CRITICAL_EXIT,
  deniedWarn,
  runScanners,
  type Finding,
  type Severity,
} from "../core/scan/index.ts";
import { ask, clackDecisions, type Decisions } from "./decisions.ts";
import { escapeControl, type PagedSkill } from "./pager.ts";
import { isInteractive, requireTTY } from "./prompt.ts";
import { logError, logFindings, logWarn, renderFiles, warn } from "./report.ts";
import { skillName } from "./style.ts";

type GateOutcome = "pass" | "declined" | "blocked";

export interface ReviewOptions {
  yes?: boolean;
  dangerousSkipCriticalApproval?: boolean;
  denyWarn?: boolean | undefined;
}

interface Reviewable extends PagedSkill {
  warnings?: string[];
}

interface GateResult<T> {
  approved: T[];
  declined: T[];
  blocked: T[];
  findings: Map<string, Finding[]>;
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
  const result: GateResult<T> = { approved: [], declined: [], blocked: [], findings: new Map() };
  for (const entry of selection) {
    const { name, files } = entry;
    p.note(renderNote(files), `${skillName(name)}: ${files.length} file(s)`);
    for (const warning of entry.warnings ?? []) logWarn(warning);
    const findings = runScanners({ name, files });
    result.findings.set(name, findings);
    const outcome = await reviewSkill(entry, findings, options, decisions);
    if (outcome === "pass") {
      result.approved.push(entry);
    } else {
      result[outcome].push(entry);
      warn(`${skillName(name)}: skipped`);
    }
  }
  return result;
};

type Stop = Exclude<Severity, "info">;

const gatesAs = (finding: Finding, denyWarn: boolean | undefined): Severity =>
  deniedWarn(finding, denyWarn) ? "critical" : finding.severity;

export const stopsOn = (findings: Finding[], options: ReviewOptions): Stop | null => {
  const gated = findings.map((finding) => gatesAs(finding, options.denyWarn));
  if (!options.dangerousSkipCriticalApproval && gated.includes("critical")) return "critical";
  if (!options.yes && gated.includes("warn")) return "warn";
  return null;
};

const blockedMessage = (name: string, stopping: Finding[]): string =>
  stopping.some((finding) => finding.severity === "critical")
    ? `${skillName(name)}: review critical findings in a terminal.`
    : `${skillName(name)}: review warn findings in a terminal. ${PROJECT_CONFIG_NAME} sets policy.denyWarn.`;

const reviewSkill = async (
  entry: PagedSkill,
  findings: Finding[],
  options: ReviewOptions,
  decisions: Decisions,
): Promise<GateOutcome> => {
  logFindings(entry.name, findings);
  const stop = stopsOn(findings, options);
  if (!stop) return "pass";
  const stopping = findings.filter((finding) => gatesAs(finding, options.denyWarn) === stop);
  if (!isInteractive()) {
    if (stop === "warn") return "pass";
    logError(blockedMessage(entry.name, stopping));
    process.exitCode = CRITICAL_EXIT;
    return "blocked";
  }
  return (await decisions.approve(entry, stop, stopping)) ? "pass" : "declined";
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
