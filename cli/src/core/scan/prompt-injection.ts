import { lineAt } from "../skill/text.ts";
import type { ProseJudge } from "./context.ts";
import type { Finding, Severity } from "./index.ts";
import { matchDetail } from "./redact.ts";
import { lower, strongest } from "./severity.ts";

const AUDIENCE = String.raw`(?:user|person|human|operator|requester)\b(?!['’]s\b)`;
const GAP = String.raw`[^.!?\n]{0,80}?`;

const OVERRIDE = /\bignore (?:all )?(?:previous|prior|above) instructions\b/giu;

const CONCEALMENT = new RegExp(
  [
    String.raw`\b(?:do not|don't|never) (?:mention|tell|reveal|disclose|show|inform|notify|alert)\s+(?:(?:this|it|that)(?:\s+\w+){0,2}?\s+)?(?:to\s+)?(?:the\s+)?${AUDIENCE}`,
    String.raw`\bwithout telling the ${AUDIENCE}`,
    String.raw`\b(?:hide|conceal|keep|omit)\b${GAP}\bfrom the ${AUDIENCE}`,
    String.raw`\b(?:confidential|secret|hidden) from the ${AUDIENCE}`,
    String.raw`\b(?:keep|remain|stay)\b${GAP}\b(?:confidential|secret|hidden|private)\b${GAP}\bfrom (?:the )?${AUDIENCE}`,
    String.raw`\btell the user only that the (?:action|task|command) (?:succeeded|completed|is safe)\b`,
    String.raw`\b(?:silently|quietly|covertly) (?:run|execute|send|upload|install|delete|modify|transfer)\b`,
  ].join("|"),
  "giu",
);

const BYPASS_PHRASES = [
  String.raw`\bwithout (?:(?:any|the|their|user|the user's|explicit|prior)\s+){0,2}(?:approval|confirmation|asking|consent|review|permission|prompting)\b`,
  String.raw`\b(?:do not|don't|never) (?:ask|prompt|confirm|check) (?:the user|before)\b`,
  String.raw`\b(?:skip|bypass|disable) (?:the )?(?:user )?(?:confirmations?|approvals?|prompts?)\b`,
  String.raw`\bauto[_-]?(?:approve|confirm|execute)`,
].join("|");

export const BYPASS = new RegExp(BYPASS_PHRASES, "iu");
const BYPASSES = new RegExp(BYPASS_PHRASES, "giu");

export type InjectionKind = "override" | "concealment" | "bypass";

export interface Injection {
  kind: InjectionKind;
  index: number;
  phrase: string;
}

const KINDS: [InjectionKind, RegExp][] = [
  ["override", OVERRIDE],
  ["concealment", CONCEALMENT],
  ["bypass", BYPASSES],
];

export const injections = (text: string): Injection[] =>
  KINDS.flatMap(([kind, pattern]) =>
    [...text.matchAll(pattern)].map((match) => ({ kind, index: match.index, phrase: match[0] })),
  ).toSorted((a, b) => a.index - b.index);

export interface InjectionContext extends ProseJudge {
  hidden: (index: number) => boolean;
  // The skill has a network, credential, persistence, or money finding.
  concealing: boolean;
  dangerNear: (line: number) => boolean;
}

// The negation in "do not tell the user" is the signal, so only an override reads prohibitions.
const severityOf = (
  { kind, index }: Injection,
  line: number,
  context: InjectionContext,
): { severity: Severity; quiet: boolean } => {
  if (kind === "override" && context.afterProhibition(index)) {
    return { severity: "info", quiet: true };
  }
  const combined =
    kind === "concealment"
      ? context.concealing || context.hidden(index)
      : kind === "bypass" && context.dangerNear(line);
  const severity = combined ? "critical" : "warn";
  return { severity: context.demoted(index) ? lower(severity) : severity, quiet: false };
};

export const promptInjection = (
  text: string,
  context: InjectionContext,
): Pick<Finding, "severity" | "line" | "detail"> | undefined => {
  const found = injections(text).map((injection) => {
    const line = lineAt(text, injection.index);
    return Object.assign(injection, { line }, severityOf(injection, line, context));
  });
  const best = strongest(found);
  if (!best) return undefined;
  return {
    severity: best.severity,
    line: best.line,
    detail: matchDetail(best.phrase, best.quiet, found.length),
  };
};
