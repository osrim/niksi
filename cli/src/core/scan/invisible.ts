import { combine, type Located } from "./combine.ts";
import type { Finding, Severity } from "./index.ts";
import { rank } from "./severity.ts";

const CANDIDATE = /[\p{Default_Ignorable_Code_Point}\p{Cf}\p{Co}\p{Cn}]/gu;
const TAG_RUN = /[\u{E0000}-\u{E007F}]+/gu;
const CANCEL_TAG = 0xe007f;

const EMOJI_BEFORE = /[\p{Extended_Pictographic}\p{Emoji_Component}]$/u;
const EMOJI_AFTER = /^\p{Extended_Pictographic}/u;
const PRESENTABLE = /\p{Emoji}$/u;
const HAN = /\p{Ideographic}$/u;
const MONGOLIAN = /\p{scx=Mongolian}$/u;
const JOINING_SCRIPT =
  /[\p{scx=Arabic}\p{scx=Devanagari}\p{scx=Bengali}\p{scx=Gurmukhi}\p{scx=Gujarati}\p{scx=Oriya}\p{scx=Tamil}\p{scx=Telugu}\p{scx=Kannada}\p{scx=Malayalam}\p{scx=Sinhala}]$/u;
// Several invisible characters in a row still sit between the letters around them.
const LETTER_BEFORE = /[A-Za-z][\p{Default_Ignorable_Code_Point}\p{Cf}\p{Co}\p{Cn}]*$/u;
const LETTER_AFTER = /^[\p{Default_Ignorable_Code_Point}\p{Cf}\p{Co}\p{Cn}]*[A-Za-z]/u;
const WINDOW = 32;

// A character this many lines from a prompt-injection match combines with it.
const NEAR_LINES = 2;
const ESCALATE_AT_COUNT = 3;

export interface InvisibleHit {
  index: number;
  count: number;
  severity: Severity;
  code: string;
  why?: string;
  // A tag run's ASCII text, with control characters escaped, and its printable length.
  tags?: { text: string; printable: number };
}

interface Hit extends InvisibleHit, Located {}

export const codeOf = (codepoint: number): string =>
  `U+${codepoint.toString(16).toUpperCase().padStart(4, "0")}`;

const before = (text: string, index: number, pattern: RegExp): boolean =>
  pattern.test(text.slice(Math.max(0, index - WINDOW), index));

const after = (text: string, index: number, pattern: RegExp): boolean =>
  pattern.test(text.slice(index, index + WINDOW));

const isVariationSelector = (cp: number): boolean =>
  (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef);

const isMongolianSelector = (cp: number): boolean => cp >= 0x180b && cp <= 0x180f;

interface Shaper {
  applies: (cp: number) => boolean;
  shapes: (text: string, index: number) => boolean;
}

// Emoji sequences, Arabic and Indic joiners, and Han and Mongolian selectors shape visible text.
const SHAPERS: Shaper[] = [
  {
    applies: (cp) => cp === 0x200d,
    shapes: (text, index) =>
      (before(text, index, EMOJI_BEFORE) && after(text, index + 1, EMOJI_AFTER)) ||
      before(text, index, JOINING_SCRIPT),
  },
  { applies: (cp) => cp === 0x200c, shapes: (text, index) => before(text, index, JOINING_SCRIPT) },
  {
    applies: (cp) => cp === 0xfe0e || cp === 0xfe0f,
    shapes: (text, index) => before(text, index, PRESENTABLE) || before(text, index, HAN),
  },
  { applies: isVariationSelector, shapes: (text, index) => before(text, index, HAN) },
  { applies: isMongolianSelector, shapes: (text, index) => before(text, index, MONGOLIAN) },
];

const shapesText = (text: string, index: number, cp: number): boolean =>
  SHAPERS.find((shaper) => shaper.applies(cp))?.shapes(text, index) ?? false;

const BIDI_CONTROL = /^\p{Bidi_Control}$/u;

const tier = (text: string, index: number, ch: string): Pick<Hit, "severity" | "why"> => {
  const cp = ch.codePointAt(0)!;
  if (cp === 0xad) return { severity: "info", why: "soft hyphen" };
  if (BIDI_CONTROL.test(ch)) return { severity: "critical", why: "bidi control" };
  if (cp >= 0xfff9 && cp <= 0xfffb) return { severity: "critical", why: "interlinear annotation" };
  if (before(text, index, LETTER_BEFORE) && after(text, index + ch.length, LETTER_AFTER)) {
    return { severity: "critical", why: "between letters" };
  }
  return { severity: "warn" };
};

const charHits = (text: string): InvisibleHit[] =>
  [...text.matchAll(CANDIDATE)].flatMap(({ 0: ch, index }) => {
    const cp = ch.codePointAt(0)!;
    // A leading U+FEFF is a byte-order mark. Tag characters are judged as runs.
    if ((cp === 0xfeff && index === 0) || (cp >= 0xe0000 && cp <= CANCEL_TAG)) return [];
    if (shapesText(text, index, cp)) return [];
    return [{ index, count: 1, code: codeOf(cp), ...tier(text, index, ch) }];
  });

const isPrintable = (ascii: number): boolean => ascii >= 0x20 && ascii < 0x7f;

const decodeTags = (codepoints: number[]): { text: string; printable: number } => {
  const ascii = codepoints.map((cp) => cp - 0xe0000);
  const text = ascii
    .map((code) =>
      isPrintable(code)
        ? String.fromCharCode(code)
        : `\\x${code.toString(16).toUpperCase().padStart(2, "0")}`,
    )
    .join("");
  return { text, printable: ascii.filter(isPrintable).length };
};

// A subdivision flag is a black flag, two to seven lowercase tag letters or digits, and a cancel tag.
const FLAG_TAGS = /^[\u{E0030}-\u{E0039}\u{E0061}-\u{E007A}]{2,7}\u{E007F}$/u;

export const TAG_TEXT = 60;

const tagHits = (text: string): InvisibleHit[] =>
  [...text.matchAll(TAG_RUN)].flatMap(({ 0: run, index }) => {
    const codepoints = [...run].map((ch) => ch.codePointAt(0)!);
    const last = codepoints.at(-1)!;
    if (before(text, index, /\u{1F3F4}$/u) && FLAG_TAGS.test(run)) return [];
    const tags = decodeTags(codepoints);
    const code = codepoints.length > 1 ? `${codeOf(codepoints[0]!)}…${codeOf(last)}` : codeOf(last);
    const why = `tags decode to "${tags.text.slice(0, TAG_TEXT)}"`;
    return [{ index, count: codepoints.length, code, severity: "critical", why, tags }];
  });

export const invisibleHits = (text: string): InvisibleHit[] => [
  ...tagHits(text),
  ...charHits(text),
];

const withLines = (text: string, hits: InvisibleHit[]): Hit[] => {
  let line = 1;
  let at = 0;
  return hits
    .toSorted((a, b) => a.index - b.index)
    .map((hit) => {
      for (
        let i = text.indexOf("\n", at);
        i !== -1 && i < hit.index;
        i = text.indexOf("\n", i + 1)
      ) {
        line++;
        at = i + 1;
      }
      return Object.assign(hit, { line });
    });
};

const escalate = (hits: Hit[], injections: Located[]): Hit[] => {
  const counted = hits.filter((hit) => hit.severity !== "info").reduce((n, h) => n + h.count, 0);
  const warns = hits.filter((hit) => hit.severity === "warn");
  const paired = new Map(
    combine(warns, injections, { within: NEAR_LINES }).map(({ anchor, partner }) => [
      anchor,
      partner,
    ]),
  );
  return hits.map((hit) => {
    if (hit.severity !== "warn") return hit;
    const partner = paired.get(hit);
    if (partner) {
      return Object.assign(hit, {
        severity: "critical",
        why: `near prompt-injection, line ${partner.line}`,
      });
    }
    return counted >= ESCALATE_AT_COUNT ? Object.assign(hit, { severity: "critical" }) : hit;
  });
};

export const label = ({ code, why }: InvisibleHit): string => (why ? `${code} (${why})` : code);

export const invisibleCharacters = (
  text: string,
  injections: Located[],
): Pick<Finding, "severity" | "line" | "detail"> | undefined => {
  const hits = escalate(withLines(text, invisibleHits(text)), injections);
  if (hits.length === 0) return undefined;
  const ranked = hits.toSorted((a, b) => rank(b.severity) - rank(a.severity) || a.index - b.index);
  const strongest = ranked[0]!;
  const total = hits.reduce((n, hit) => n + hit.count, 0);
  const sample = [...new Set(ranked.map(label))].slice(0, 5).join(", ");
  return {
    severity: strongest.severity,
    line: strongest.line,
    detail: `${total} invisible character(s): ${sample}`,
  };
};
