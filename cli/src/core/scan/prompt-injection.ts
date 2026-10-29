import { lineAt } from "../skill/text.ts";
import type { ProseJudge } from "./context.ts";
import type { Confidence, Finding, Severity } from "./index.ts";
import { matchDetail } from "./redact.ts";
import { gated, lower, strongest } from "./severity.ts";

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
  confidence: Confidence;
  hidden: (index: number) => boolean;
  // The confidence a network, credential, persistence, or money finding gives a concealment phrase.
  concealing: Confidence | undefined;
  dangerNear: (line: number) => boolean;
}

// The confidence of the partner that raises the phrase to critical, if any.
const escalation = (
  { kind, index }: Injection,
  line: number,
  context: InjectionContext,
): Confidence | undefined => {
  if (kind === "concealment")
    return context.hidden(index) ? context.confidence : context.concealing;
  return kind === "bypass" && context.dangerNear(line) ? context.confidence : undefined;
};

// The negation in "do not tell the user" is the signal, so only an override reads prohibitions.
const severityOf = (
  injection: Injection,
  line: number,
  context: InjectionContext,
): { severity: Severity; confidence: Confidence; quiet: boolean } => {
  if (injection.kind === "override" && context.afterProhibition(injection.index)) {
    return { severity: "info", confidence: context.confidence, quiet: true };
  }
  const raised = escalation(injection, line, context);
  const confidence = raised ?? context.confidence;
  const severity = raised ? "critical" : "warn";
  const judged = context.demoted(injection.index) ? lower(severity) : severity;
  // Gated here as well, so the strongest match is picked by the severity the finding shows.
  return { severity: gated(judged, confidence), confidence, quiet: false };
};

export const promptInjection = (
  text: string,
  context: InjectionContext,
): Pick<Finding, "severity" | "confidence" | "line" | "detail"> | undefined => {
  const found = injections(text).map((injection) => {
    const line = lineAt(text, injection.index);
    return Object.assign(injection, { line }, severityOf(injection, line, context));
  });
  const best = strongest(found);
  if (!best) return undefined;
  return {
    severity: best.severity,
    confidence: best.confidence,
    line: best.line,
    detail: matchDetail(best.phrase, best.quiet, found.length),
  };
};
