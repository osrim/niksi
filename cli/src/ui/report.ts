import * as p from "@clack/prompts";
import prettyBytes from "pretty-bytes";
import { isSymlink, type SkillFile } from "../core/skill/files.ts";
import type { Finding, Severity } from "../core/scan/index.ts";
import {
  blue,
  bold,
  dim,
  escapeControl,
  escapeLine,
  orange,
  pad,
  red,
  skillName,
} from "./style.ts";

const headline =
  (paint: (text: string) => string) =>
  (message: string): string => {
    const [first = "", ...rest] = message.split("\n");
    return [paint(first), ...rest].join("\n");
  };

export const logError = (message: string): void =>
  p.log.error(headline(red)(message), { output: process.stderr });

export const logWarn = (message: string): void =>
  p.log.warn(headline(orange)(message), { output: process.stderr });

export const logSkillError = (name: string, cause: unknown): void =>
  logError(`${skillName(name)}: ${(cause as Error).message}`);

export const reviewWarn = (message: string): void => p.log.warn(headline(orange)(message));

export const fileLabel = (file: SkillFile): string =>
  `${escapeLine(file.path)} (${isSymlink(file.mode) ? "symlink" : prettyBytes(file.content.length)})`;

export const renderFiles = (files: SkillFile[]): string => files.map(fileLabel).join("\n");

const LOG_BY_SEVERITY: Record<Severity, (message: string) => void> = {
  info: p.log.info,
  warn: p.log.warn,
  critical: p.log.error,
};

export const logSourceCaution = (): void => {
  reviewWarn(bold("Review files before installing."));
};

const SEVERITY_COLOR: Record<Severity, (text: string) => string> = {
  critical: red,
  warn: orange,
  info: blue,
};

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

const sectionTitle = (severity: Severity, bucket: Finding[]): string =>
  severity === "critical"
    ? `${plural(bucket.length, "critical finding")}`
    : plural(bucket.length, `${severity} finding`);

const detailOf = (finding: Finding): string => {
  const marks = [
    ...(finding.confidence === "low" ? ["low confidence"] : []),
    ...(finding.accepted ? ["accepted"] : []),
  ];
  const detail = escapeControl(finding.detail);
  return marks.length > 0 ? `${detail}${dim(` (${marks.join(", ")})`)}` : detail;
};

const locationOf = (finding: Finding): string => {
  if (!finding.file) return "";
  const file = escapeLine(finding.file);
  return finding.line ? `${file}:${finding.line}` : file;
};

export const renderFindings = (name: string, findings: Finding[]): string => {
  if (findings.length === 0) {
    return `${skillName(name)}: no findings`;
  }

  const lines = [`${skillName(name)}: ${bold("security scan")}`];

  for (const severity of ["critical", "warn", "info"] as const) {
    const bucket = findings.filter((finding) => finding.severity === severity);
    if (bucket.length === 0) continue;

    lines.push("", bold(SEVERITY_COLOR[severity](sectionTitle(severity, bucket))));
    for (const [rule, group] of Map.groupBy(bucket, (finding) => finding.rule)) {
      lines.push(`  ${bold(rule)}${dim(`: ${group[0]!.help}`)}`);
      const width = Math.max(...group.map((finding) => Bun.stringWidth(locationOf(finding))));
      let previous: Finding | undefined;
      for (const finding of group) {
        const where = locationOf(finding);
        const repeated = finding.file === previous?.file && finding.line === previous?.line;
        const shown = repeated ? "" : where;
        previous = finding;
        const detail = detailOf(finding);
        lines.push(where ? `    ${pad(shown, width)}  ${detail}` : `    ${detail}`);
      }
    }
  }

  return lines.join("\n");
};

export const logFindings = (name: string, findings: Finding[]): void => {
  const message = renderFindings(name, findings);
  if (findings.length === 0) {
    p.log.success(message);
    return;
  }
  const worst: Severity = findings.some(
    (finding) => finding.severity === "critical" && !finding.accepted,
  )
    ? "critical"
    : findings.some((finding) => finding.severity !== "info")
      ? "warn"
      : "info";
  LOG_BY_SEVERITY[worst](message);
};
