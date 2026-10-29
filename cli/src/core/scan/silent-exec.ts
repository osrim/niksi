import { lineAt } from "../skill/text.ts";
import { combine, type Located } from "./combine.ts";
import type { ProseJudge } from "./context.ts";
import type { Finding, Severity } from "./index.ts";
import { commandName } from "./interpreter.ts";
import {
  oncePerLine,
  patternMatch,
  statementMatch,
  strongestLine,
  type LineMatch,
} from "./line-match.ts";
import type { Statement } from "./shell.ts";

const DETACHERS = new Set(["nohup", "setsid"]);
const NULL_DEVICE = "/dev/null";
const REDIRECT = /^(&|1|2)?>>?(.*)$/u;

// Order matters: `> /dev/null 2>&1` silences both streams, `2>&1 > /dev/null` only stdout.
const silenced = (words: string[]): boolean => {
  let out = false;
  let err = false;
  for (let i = 0; i < words.length; i++) {
    if (words[i] === "2>&1") {
      err = out;
      continue;
    }
    const redirect = REDIRECT.exec(words[i]!);
    if (!redirect) continue;
    const target = redirect[2] || words[++i];
    const stream = redirect[1] || "1";
    if (stream !== "2") out = target === NULL_DEVICE;
    if (stream !== "1") err = target === NULL_DEVICE;
  }
  return out && err;
};

const detaches = (statement: Statement): boolean =>
  statement.commands.some(
    ({ words, wrappers }) =>
      (words.length > 0 && wrappers.some((wrapper) => DETACHERS.has(wrapper))) ||
      commandName(words[0] ?? "") === "disown" ||
      (statement.background && silenced(words)),
  );

const DEVNULL = String.raw`\s*=\s*(?:subprocess\.)?DEVNULL\b`;
const NEARBY = 5;
// A multiline options object and the child's event handlers can sit between `spawn(` and `.unref()`.
const AFTER_SPAWN = 20;

interface Pairing {
  anchor: RegExp;
  partner: RegExp;
  within: number;
  // The partner may come before the anchor, but not after it.
  before?: boolean;
}

const PAIRINGS: Pairing[] = [
  {
    anchor: new RegExp(`\\bstdout${DEVNULL}`, "gu"),
    partner: new RegExp(`\\bstderr${DEVNULL}`, "gu"),
    within: NEARBY,
  },
  {
    anchor: /\bdetached\s*:\s*true\b/gu,
    partner: /\bstdio\s*:\s*["']ignore["']/gu,
    within: NEARBY,
  },
  {
    anchor: /\.unref\(\s*\)/gu,
    partner: /\b(?:spawn|fork)\s*\(/gu,
    within: AFTER_SPAWN,
    before: true,
  },
];
const ALONE = /\bstart_new_session\s*=\s*True\b/gu;

interface TextMatch extends Located {
  index: number;
  text: string;
}

const lineText = (text: string, index: number): string => {
  const end = text.indexOf("\n", index);
  return text.slice(text.lastIndexOf("\n", index - 1) + 1, end === -1 ? text.length : end).trim();
};

const textMatches = (text: string, pattern: RegExp): TextMatch[] =>
  [...text.matchAll(pattern)].map(({ index }) => ({
    index,
    line: lineAt(text, index),
    text: lineText(text, index),
  }));

const languageMatches = (text: string): TextMatch[] => [
  ...textMatches(text, ALONE),
  ...PAIRINGS.flatMap(({ anchor, partner, within, before }) =>
    combine(textMatches(text, anchor), textMatches(text, partner), {
      within,
      related: (a, p) => !before || p.line <= a.line,
    }).map((pair) => pair.anchor),
  ),
];

interface Candidate extends Located {
  index: number;
  match: (severity: Severity) => LineMatch;
}

// `partners` are the file's curl-pipe-shell, base64-exec, and persistence matches above info.
export const silentExec = (
  text: string,
  statements: Statement[],
  judge: ProseJudge,
  partners: () => Located[],
): Pick<Finding, "severity" | "line" | "detail"> | undefined => {
  const at = patternMatch(text, statements, judge);
  const candidates: Candidate[] = [
    ...statements.filter(detaches).map((statement) => ({
      line: statement.line,
      index: statement.index,
      match: (severity: Severity) =>
        statementMatch(
          statement,
          judge,
          severity,
          statement.background ? `${statement.text} &` : statement.text,
        ),
    })),
    ...languageMatches(text).map(({ line, index, text: found }) => ({
      line,
      index,
      match: (severity: Severity) => at(index, found, severity),
    })),
  ];
  if (candidates.length === 0) return undefined;
  const paired = new Set(combine(candidates, partners()).map(({ anchor }) => anchor));
  return strongestLine(
    oncePerLine(candidates.map((c) => c.match(paired.has(c) ? "critical" : "warn"))),
  );
};
