import type { MarkdownMap } from "../skill/markdown.ts";
import { lineAt } from "../skill/text.ts";
import type { ProseJudge } from "./context.ts";
import type { Finding, Severity } from "./index.ts";
import { matchDetail } from "./redact.ts";
import { lower, strongest } from "./severity.ts";

export interface Sentence {
  // Offset of the first non-space character in the scanned text.
  index: number;
  text: string;
}

const BOUNDARY = /(?<=[.!?])\s+|\n[ \t]*\n|\n(?=[ \t]*(?:[-*+]|\d+[.)]|#{1,6})[ \t])/gu;

export const sentences = (text: string, offset = 0): Sentence[] => {
  const found: Sentence[] = [];
  let start = 0;
  const add = (end: number): void => {
    const raw = text.slice(start, end);
    const lead = raw.length - raw.trimStart().length;
    if (raw.trim()) found.push({ index: offset + start + lead, text: raw.trim() });
  };
  for (const boundary of text.matchAll(BOUNDARY)) {
    add(boundary.index);
    start = boundary.index + boundary[0].length;
  }
  add(text.length);
  return found;
};

const VISIBLE = new Set(["prose", "inline"]);

const visibleText = (text: string, map: MarkdownMap): string =>
  text.replaceAll(/[^\n]/gu, (ch: string, i: number) =>
    VISIBLE.has(map.contextAt(i)) ? ch : " ".repeat(ch.length),
  );

// A field starts at an unindented key, so a folded value stays one field.
const FIELD = /\n(?=---|[^\s#][^\n]*:)/gu;

const frontmatterSentences = (text: string, map: MarkdownMap): Sentence[] =>
  map.spans("frontmatter").flatMap(({ start, end }) => {
    const block = text.slice(start, end);
    const starts = [0, ...[...block.matchAll(FIELD)].map((field) => field.index + 1)];
    return starts
      .flatMap((from, i) =>
        sentences(block.slice(from, starts[i + 1] ?? block.length), start + from),
      )
      .filter((sentence) => sentence.text !== "---");
  });

// Visible Markdown prose and each frontmatter field. Without a map the whole text is prose.
export const proseSentences = (text: string, map: MarkdownMap | undefined): Sentence[] =>
  map
    ? [...sentences(visibleText(text, map)), ...frontmatterSentences(text, map)]
    : sentences(text);

export interface Phrase {
  // Offset of the word a prohibition would govern, such as the verb.
  index: number;
  sentence: string;
  severity: Severity;
}

export interface JudgedPhrase extends Phrase {
  line: number;
  quiet: boolean;
}

// A prohibition before the phrase makes it info. Docs and demo prose lower it one level.
export const judgePhrases = (
  text: string,
  phrases: Phrase[],
  { afterProhibition, demoted }: ProseJudge,
): JudgedPhrase[] =>
  phrases
    .toSorted((a, b) => a.index - b.index)
    .map((phrase) => {
      const quiet = afterProhibition(phrase.index);
      const lowered = demoted(phrase.index) ? lower(phrase.severity) : phrase.severity;
      return Object.assign(phrase, {
        line: lineAt(text, phrase.index),
        quiet,
        severity: quiet ? "info" : lowered,
      });
    });

export const reportPhrases = (
  text: string,
  phrases: Phrase[],
  judge: ProseJudge,
): Pick<Finding, "severity" | "line" | "detail"> | undefined => {
  const judged = judgePhrases(text, phrases, judge);
  const best = strongest(judged);
  if (!best) return undefined;
  return {
    severity: best.severity,
    line: best.line,
    detail: matchDetail(best.sentence, best.quiet, judged.length),
  };
};
