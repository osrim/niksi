import type { MarkdownMap } from "../skill/markdown.ts";
import { lineAt } from "../skill/text.ts";
import type { Finding, Severity } from "./index.ts";
import { proseSentences, sentences, type Sentence } from "./prose.ts";
import { excerpt } from "./redact.ts";
import { lower, stronger } from "./severity.ts";

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

const matches = (found: Sentence[], hidden: boolean): Match[] =>
  found.flatMap(({ index, text: sentence }) => {
    if (!FETCH.test(sentence) || !URL_TEXT.test(sentence) || !OBEY.test(sentence)) return [];
    const severity = hidden || SCHEDULE.test(sentence) ? "critical" : "warn";
    return [{ index, sentence, severity }];
  });

// Without a map the whole text is prose. Frontmatter is never demoted.
export const remoteInstructions = (
  text: string,
  map: MarkdownMap | undefined,
  demoted: (index: number) => boolean,
): Pick<Finding, "severity" | "line" | "detail"> | undefined => {
  const found = [
    ...matches(proseSentences(text, map), false).map((match) =>
      demoted(match.index) ? Object.assign(match, { severity: lower(match.severity) }) : match,
    ),
    ...matches(
      (map?.hidden ?? []).flatMap(({ start, end }) => sentences(text.slice(start, end), start)),
      true,
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
