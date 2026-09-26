import * as p from "@clack/prompts";
import type { SkillFile } from "../core/skill/files.ts";
import { asText, parseFrontmatter } from "../core/skill/frontmatter.ts";
import { CRITICAL_EXIT, runScanners, type Finding, type Severity } from "../core/scan/index.ts";
import { escapeControl, pageSkills, type PagedSkill } from "./pager.ts";
import { isInteractive, requireTTY, unwrap } from "./prompt.ts";
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
  blocked: boolean;
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
): Promise<GateResult<T>> => {
  const approved: T[] = [];
  let blocked = false;
  for (const entry of selection) {
    const { name, files } = entry;
    p.note(renderNote(files), `${skillName(name)}: ${files.length} file(s)`);
    for (const warning of entry.warnings ?? []) logWarn(warning);
    const outcome = await reviewSkill(entry, options);
    if (outcome === "pass") {
      approved.push(entry);
    } else {
      if (outcome === "blocked") blocked = true;
      warn(`${skillName(name)}: skipped`);
    }
  }
  return { approved, blocked };
};

export const stopsOn = (
  findings: Finding[],
  { yes, dangerousSkipCriticalApproval }: ReviewOptions,
): Severity | null => {
  if (!dangerousSkipCriticalApproval && findings.some((finding) => finding.severity === "critical"))
    return "critical";
  if (!yes && findings.some((finding) => finding.severity === "warn")) return "warn";
  return null;
};

const reviewSkill = async (entry: PagedSkill, options: ReviewOptions): Promise<GateOutcome> => {
  const findings = runScanners({ name: entry.name, files: entry.files });
  logFindings(entry.name, findings);
  const stop = stopsOn(findings, options);
  if (!stop) return "pass";
  const stopping = findings.filter((finding) => finding.severity === stop);
  const outcome =
    stop === "critical"
      ? await askApproval(entry, stopping)
      : await askWarnFindings(entry, stopping);
  if (outcome === "blocked") process.exitCode = CRITICAL_EXIT;
  return outcome;
};

type Answer = "yes" | "no" | "read";

const ask = async (
  message: string,
  initialValue: boolean,
  reading: PagedSkill[],
): Promise<boolean> => {
  if (reading.length === 0) return unwrap(await p.confirm({ message, initialValue }));
  for (;;) {
    const answer = unwrap(
      await p.select<Answer>({
        message,
        initialValue: initialValue ? "yes" : "no",
        options: [
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" },
          { value: "read", label: "Read files…", hint: "press q to return" },
        ],
      }),
    );
    if (answer !== "read") return answer === "yes";
    await pageSkills(reading);
  }
};

const askApproval = async (entry: PagedSkill, criticals: Finding[]): Promise<GateOutcome> => {
  if (!isInteractive()) {
    logError(`${skillName(entry.name)}: review critical findings in a terminal.`);
    return "blocked";
  }
  const message = `Approve ${skillName(entry.name)} with ${criticals.length} critical finding(s)?`;
  return (await ask(message, false, [entry])) ? "pass" : "declined";
};

const askWarnFindings = async (
  entry: PagedSkill,
  warnFindings: Finding[],
): Promise<GateOutcome> => {
  if (!isInteractive()) return "pass";
  const message = `Continue with ${skillName(entry.name)} and ${warnFindings.length} warn finding(s)?`;
  return (await ask(message, true, [entry])) ? "pass" : "declined";
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
