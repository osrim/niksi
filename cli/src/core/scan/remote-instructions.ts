import type { MarkdownMap } from "../skill/markdown.ts";
import { lineAt } from "../skill/text.ts";
import type { Finding, Severity } from "./index.ts";
import { excerpt } from "./redact.ts";
import { lower, stronger } from "./severity.ts";

const BOUNDARY = /(?<=[.!?])\s+|\n[ \t]*\n|\n(?=[ \t]*(?:[-*+]|\d+[.)]|#{1,6})[ \t])/gu;

const FETCH =
  /\b(?:fetch|download|retrieve|load|read|pull|visit|grab|consult|curl|wget|go to|navigate to)\b/iu;
const URL_TEXT = /\bhttps?:\/\/\S|\bwww\.\S/iu;
const OBEY =
  /\b(?:follow|obey|execute|run|apply|adopt|comply with|act on|carry out|perform|implement)(?:\s+\S+){0,3}?\s+(?:instructions?|rules?|directives?|commands?|steps|guidance|guidelines|orders|prompts?|tasks?|polic(?:y|ies))\b/iu;
const SCHEDULE = /\bbefore (?:every|each)\b|\balways\b/iu;

const DETAIL_LENGTH = 160;

interface Match {
  index: number;
  sentence: string;
  severity: Severity;
}

const sentences = (text: string): { index: number; text: string }[] => {
  const found: { index: number; text: string }[] = [];
  let start = 0;
  for (const boundary of text.matchAll(BOUNDARY)) {
    found.push({ index: start, text: text.slice(start, boundary.index) });
    start = boundary.index + boundary[0].length;
  }
  return [...found, { index: start, text: text.slice(start) }];
};

const matches = (text: string, offset: number, hidden: boolean): Match[] =>
  sentences(text).flatMap(({ index, text: sentence }) => {
    if (!FETCH.test(sentence) || !URL_TEXT.test(sentence) || !OBEY.test(sentence)) return [];
    const severity = hidden || SCHEDULE.test(sentence) ? "critical" : "warn";
    const lead = sentence.length - sentence.trimStart().length;
    return [{ index: offset + index + lead, sentence: sentence.trim(), severity }];
  });

const VISIBLE = new Set(["prose", "inline"]);

const visibleText = (text: string, map: MarkdownMap): string =>
  text.replaceAll(/[^\n]/gu, (ch: string, i: number) =>
    VISIBLE.has(map.contextAt(i)) ? ch : " ".repeat(ch.length),
  );

// A field starts at an unindented key, so a folded value stays one field.
const FIELD = /\n(?=---|[^\s#][^\n]*:)/gu;

const frontmatterMatches = (text: string, map: MarkdownMap): Match[] =>
  map.spans("frontmatter").flatMap(({ start, end }) => {
    const block = text.slice(start, end);
    const starts = [0, ...[...block.matchAll(FIELD)].map((field) => field.index + 1)];
    return starts.flatMap((from, i) =>
      matches(block.slice(from, starts[i + 1] ?? block.length), start + from, false),
    );
  });

// Without a map the whole text is prose.
export const remoteInstructions = (
  text: string,
  map: MarkdownMap | undefined,
  demoted: (index: number) => boolean,
): Pick<Finding, "severity" | "line" | "detail"> | undefined => {
  const visible = map ? visibleText(text, map) : text;
  const found = [
    ...matches(visible, 0, false).map((match) =>
      demoted(match.index) ? Object.assign(match, { severity: lower(match.severity) }) : match,
    ),
    ...(map ? frontmatterMatches(text, map) : []),
    ...(map?.hidden ?? []).flatMap(({ start, end }) =>
      matches(text.slice(start, end), start, true),
    ),
  ];
  const best = found.reduce<Match | undefined>(
    (a, b) =>
      !a || stronger(b.severity, a.severity) || (b.severity === a.severity && b.index < a.index)
        ? b
        : a,
    undefined,
  );
  if (!best) return undefined;
  const count = found.length > 1 ? ` (${found.length} matches)` : "";
  return {
    severity: best.severity,
    line: lineAt(text, best.index),
    detail: `${excerpt(best.sentence, DETAIL_LENGTH)}${count}`,
  };
};
