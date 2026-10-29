import type { Finding } from "./index.ts";
import { excerpt } from "./redact.ts";

const GAP_LINES = 20;
const PAD_WIDTH = 200;
const SNIPPET_LENGTH = 80;

const BLANK = /^[ \t\r]*$/u;
const PAD = new RegExp(String.raw`[ \t]{${PAD_WIDTH},}(?=\S)`, "gu");
// Padding before a table border or a box-drawing character aligns columns.
const ALIGNED = /^[|\u{2500}-\u{257F}]/u;

interface Pad {
  line: number;
  what: string;
  // The text the padding pushes out of view.
  pushed: string;
}

const lineStarts = (lines: string[]): number[] => {
  const starts = [0];
  for (const line of lines) starts.push(starts.at(-1)! + line.length + 1);
  return starts;
};

// A gap pushes the text after it, up to the next gap.
const gaps = (text: string, lines: string[]): Pad[] => {
  const starts = lineStarts(lines);
  const found: { line: number; blank: number }[] = [];
  let blank = 0;
  for (const [i, line] of lines.entries()) {
    if (BLANK.test(line)) {
      blank++;
      continue;
    }
    if (blank >= GAP_LINES) found.push({ line: i, blank });
    blank = 0;
  }
  return found.map(({ line, blank: count }, i) => ({
    line: line + 1,
    what: `${count} blank lines`,
    pushed: text.slice(starts[line], starts[found[i + 1]?.line ?? lines.length]),
  }));
};

const runs = (lines: string[]): Pad[] =>
  lines.flatMap((line, i) =>
    [...line.matchAll(PAD)].flatMap(({ 0: run, index }) => {
      const pushed = line.slice(index + run.length);
      if (ALIGNED.test(pushed)) return [];
      return [{ line: i + 1, what: `${run.length} spaces or tabs`, pushed }];
    }),
  );

const criticalRules = (found: Finding[]): string[] => [
  ...new Set(found.flatMap((f) => (f.severity === "critical" ? [f.rule] : []))),
];

// `scan` runs the text rules over the pushed text. The first pad whose text has a critical match wins.
export const whitespacePadding = (
  text: string,
  scan: (pushed: string) => Finding[],
): Pick<Finding, "severity" | "line" | "detail"> | undefined => {
  const lines = text.split("\n");
  const pads = [...gaps(text, lines), ...runs(lines)].toSorted((a, b) => a.line - b.line);
  if (pads.length === 0) return undefined;
  let best = pads[0]!;
  let rules: string[] = [];
  for (const pad of pads) {
    rules = criticalRules(scan(pad.pushed));
    if (rules.length === 0) continue;
    best = pad;
    break;
  }
  const detail = [
    `${best.what} before "${excerpt(best.pushed.split("\n", 1)[0]!, SNIPPET_LENGTH)}"`,
    ...(rules.length > 0 ? [`(${rules.join(", ")})`] : []),
    ...(pads.length > 1 ? [`(${pads.length} matches)`] : []),
  ].join(" ");
  return { severity: rules.length > 0 ? "critical" : "warn", line: best.line, detail };
};
