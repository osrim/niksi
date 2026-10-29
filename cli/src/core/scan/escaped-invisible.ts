import type { Finding, Severity } from "./index.ts";
import { invisibleHits, label, type InvisibleHit } from "./invisible.ts";
import { excerpt } from "./redact.ts";
import { rank } from "./severity.ts";

const ESCAPE =
  /\\u\{(\p{AHex}{1,6})\}|\\u(\p{AHex}{4})|\\U(\p{AHex}{8})|&#[xX](\p{AHex}{1,6});|&#(\d{1,7});|((?:%\p{AHex}{2})+)/gu;
const HINT = /[\\&%]/u;

// A cue starts a word or a camelCase part, as in `expect(`, `assertEqual`, or `isTest`.
const TEST_CUE =
  /\b(?:test|spec|expect|assert|fixture|TEST|SPEC|EXPECT|ASSERT|FIXTURE)|(?:Test|Spec|Expect|Assert|Fixture)/u;

const CRITICAL_TAGS = 4;
const CODES_LENGTH = 60;
const TAGS_LENGTH = 60;

const MAX_CODE_POINT = 0x10ffff;

const fromCodePoint = (hex: string | undefined, radix = 16): string | undefined => {
  const cp = hex === undefined ? undefined : Number.parseInt(hex, radix);
  return cp === undefined || cp > MAX_CODE_POINT ? undefined : String.fromCodePoint(cp);
};

// A UTF-16 escape decodes alone, so two in a row join into a surrogate pair.
const decodeEscape = (match: RegExpExecArray): string | undefined => {
  const [, braced, utf16, long, hex, decimal, percent] = match;
  if (utf16) return String.fromCharCode(Number.parseInt(utf16, 16));
  if (percent) {
    try {
      return decodeURIComponent(percent);
    } catch {
      return undefined;
    }
  }
  return fromCodePoint(braced ?? long ?? hex) ?? fromCodePoint(decimal, 10);
};

interface DecodedLine {
  text: string;
  // Whether each UTF-16 unit of `text` came from an escape.
  escaped: boolean[];
}

const decodeLine = (line: string): DecodedLine => {
  let text = "";
  const escaped: boolean[] = [];
  let at = 0;
  const append = (part: string, isEscape: boolean): void => {
    text += part;
    escaped.push(...Array.from({ length: part.length }, () => isEscape));
  };
  for (const match of line.matchAll(ESCAPE)) {
    const decoded = decodeEscape(match);
    if (decoded === undefined) continue;
    append(line.slice(at, match.index), false);
    append(decoded, true);
    at = match.index + match[0].length;
  }
  append(line.slice(at), false);
  return { text, escaped };
};

interface Hit extends InvisibleHit {
  line: number;
}

const lineHits = (line: string, number: number): Hit[] => {
  if (!HINT.test(line) || TEST_CUE.test(line)) return [];
  const { text, escaped } = decodeLine(line);
  return invisibleHits(text)
    .filter((hit) => escaped[hit.index])
    .map((hit) => Object.assign(hit, { line: number }));
};

const capped = (hit: InvisibleHit): Severity => (hit.severity === "info" ? "info" : "warn");

export const escapedInvisibles = (
  text: string,
): Pick<Finding, "severity" | "line" | "detail"> | undefined => {
  const hits = text.split("\n").flatMap((line, i) => lineHits(line, i + 1));
  if (hits.length === 0) return undefined;
  const tagRuns = hits.filter((hit) => hit.tags !== undefined);
  const tagCount = tagRuns.reduce((n, hit) => n + hit.count, 0);
  const total = hits.reduce((n, hit) => n + hit.count, 0);
  // Tags split over several strings, as in `"\u{E0069}" + "\u{E0067}"`, decode as one text.
  if (tagCount >= CRITICAL_TAGS) {
    const codes = tagRuns.map((hit) => hit.code).join(", ");
    const tags = tagRuns.map((hit) => hit.tags).join("");
    return {
      severity: "critical",
      line: tagRuns[0]!.line,
      detail: `${total} escaped invisible character(s): ${excerpt(codes, CODES_LENGTH)} (tags decode to "${tags.slice(0, TAGS_LENGTH)}")`,
    };
  }
  const ranked = hits.toSorted((a, b) => rank(capped(b)) - rank(capped(a)));
  const sample = [...new Set(ranked.map(label))].slice(0, 5).join(", ");
  return {
    severity: capped(ranked[0]!),
    line: ranked[0]!.line,
    detail: `${total} escaped invisible character(s): ${sample}`,
  };
};
