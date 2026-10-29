import { scopeFlag } from "./install/scope.ts";
import type { Scope } from "./paths.ts";
import type { Finding, Severity } from "./scan/index.ts";
import { shortId, type Labelled } from "./source/revision.ts";
import type { UpdateVerdict } from "./source/upstream.ts";

export interface ReportedChange {
  name: string;
  from: Labelled;
  to: Labelled;
  stat?: string;
  findings: Finding[];
}

export type ReportedSkip =
  | { kind: "declined" | "not-confirmed" | "not-selected" | "gone" | "disabled"; name: string }
  | { kind: "failed" | "unreachable"; name: string; error: string }
  | { kind: "pinned"; name: string; from: Labelled; to: Labelled }
  | { kind: "rewritten"; name: string; pinnedAs: string; expected: Labelled; actual: Labelled };

export interface UpdateReport {
  scope: Scope;
  updated: ReportedChange[];
  blocked: ReportedChange[];
  skipped: ReportedSkip[];
  upToDate: string[];
}

const SEVERITIES: [Severity, string][] = [
  ["critical", "Critical"],
  ["warn", "Warn"],
  ["info", "Info"],
];

const HIDDEN =
  // oxlint-disable-next-line no-control-regex -- this regex exists to find control characters.
  /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/gu;

const reveal = (text: string): string =>
  text.replace(HIDDEN, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);

const longestRun = (text: string): number =>
  Math.max(0, ...(text.match(/`+/gu) ?? []).map((run) => run.length));

const code = (text: string): string => {
  const flat = reveal(text.replace(/\r?\n/gu, " "));
  const ticks = "`".repeat(longestRun(flat) + 1);
  const pad = flat.includes("`") || flat.startsWith(" ") || flat.endsWith(" ") ? " " : "";
  return `${ticks}${pad}${flat}${pad}${ticks}`;
};

const fence = (text: string): string[] => {
  const body = reveal(text.trimEnd());
  const ticks = "`".repeat(Math.max(3, longestRun(body) + 1));
  return [`${ticks}text`, ...body.split("\n"), ticks];
};

const revision = (entry: Labelled): string => {
  const id = shortId(entry);
  const name = entry.pinnedAs ?? entry.tag;
  return name ? `${code(name)} (${code(id)})` : code(id);
};

const location = ({ file, line }: Finding): string =>
  file ? ` in ${code(line ? `${file}:${line}` : file)}` : "";

const confidenceNote = ({ confidence }: Finding): string =>
  confidence === "low" ? " (low confidence)" : "";

const findingLine = (finding: Finding): string =>
  `- ${code(finding.rule)} (${finding.help})${location(finding)}: ${code(finding.detail)}${confidenceNote(finding)}`;

const renderFindings = (findings: Finding[]): string[] => {
  const lines: string[] = [];
  for (const [severity, title] of SEVERITIES) {
    const bucket = findings.filter((finding) => finding.severity === severity);
    if (bucket.length > 0) lines.push(`${title}:`, "", ...bucket.map(findingLine), "");
  }
  return lines;
};

const renderChange = (change: ReportedChange): string[] => [
  `#### ${code(change.name)}`,
  "",
  `${revision(change.from)} → ${revision(change.to)}`,
  "",
  ...(change.stat === undefined
    ? ["No file changes.", ""]
    : [
        ...fence(change.stat),
        "",
        ...(change.findings.length === 0 ? ["No findings.", ""] : renderFindings(change.findings)),
      ]),
];

const reason = (skip: ReportedSkip): string => {
  switch (skip.kind) {
    case "declined":
      return "declined at review";
    case "not-confirmed":
      return "write not confirmed";
    case "not-selected":
      return "update available, not selected";
    case "gone":
      return "no longer in the source";
    case "disabled":
      return "disabled, not checked";
    case "failed":
      return `write failed: ${code(skip.error)}`;
    case "unreachable":
      return `no upstream: ${code(skip.error)}`;
    case "pinned":
      return `pinned at ${revision(skip.from)}, latest ${revision(skip.to)}`;
    case "rewritten":
      return `pinned ref ${code(skip.pinnedAs)} was rewritten from ${revision(skip.expected)} to ${revision(skip.actual)}`;
  }
};

const section = (title: string, lines: string[]): string[] =>
  lines.length === 0 ? [] : [`### ${title}`, "", ...lines];

const blockedIntro = ({ blocked, scope }: UpdateReport): string[] => {
  const names = blocked.map((change) => change.name).join(" ");
  return [
    `Critical findings block these skills until someone approves them in a terminal: ${code(`nik update ${names}${scopeFlag(scope)}`)}.`,
    "",
  ];
};

export const renderUpdateReport = (report: UpdateReport): string => {
  const body = [
    ...section("Updated", report.updated.flatMap(renderChange)),
    ...section(
      "Needs a person",
      report.blocked.length === 0
        ? []
        : [...blockedIntro(report), ...report.blocked.flatMap(renderChange)],
    ),
    ...section("Not updated", [
      ...report.skipped.map((skip) => `- ${code(skip.name)}: ${reason(skip)}`),
      ...(report.skipped.length === 0 ? [] : [""]),
    ]),
    ...section(
      "Up to date",
      report.upToDate.length === 0 ? [] : [report.upToDate.toSorted().map(code).join(", "), ""],
    ),
  ];
  return [
    `## nik update (${report.scope})`,
    "",
    ...(body.length === 0 ? ["No skill changed.", ""] : body),
  ].join("\n");
};

const skipOf = (verdict: UpdateVerdict): ReportedSkip | null => {
  const { name } = verdict.skill;
  switch (verdict.kind) {
    case "unreachable":
      return { kind: "unreachable", name, error: verdict.error };
    case "gone":
      return { kind: "gone", name };
    case "rewritten":
      return {
        kind: "rewritten",
        name,
        pinnedAs: verdict.pinnedAs,
        expected: { commit: verdict.expected },
        actual: { commit: verdict.actual },
      };
    case "pinned":
      return { kind: "pinned", name, from: verdict.skill, to: verdict.upstream };
    case "moved":
    case "outdated":
    case "up-to-date":
      return null;
  }
};

export const recordVerdicts = (report: UpdateReport, verdicts: UpdateVerdict[]): void => {
  for (const verdict of verdicts) {
    const skip = skipOf(verdict);
    if (skip) report.skipped.push(skip);
    else if (verdict.kind === "up-to-date") report.upToDate.push(verdict.skill.name);
  }
};
