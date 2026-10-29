import type { Finding } from "./index.ts";
import { excerpt } from "./redact.ts";

const GAP_LINES = 20;
const PAD_WIDTH = 200;
const SNIPPET_LENGTH = 80;

const BLANK = /^[ \t\r]*$/u;
const RUN = /[ \t]+/gu;
const NOT_SPACE = /\S/u;
// Padding before a table border or a box-drawing character usually aligns columns.
const ALIGNED = /^[|\u{2500}-\u{257F}]/u;

interface Pad {
  line: number;
  what: string;
  // The text the padding pushes out of view.
  pushed: string;
  aligned: boolean;
  // Later runs on a line push text inside the first run's text, so only the first is scanned.
  scanned: boolean;
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
    aligned: false,
    scanned: true,
  }));
};

const runs = (lines: string[]): Pad[] =>
  lines.flatMap((line, i) =>
    [...line.matchAll(RUN)]
      .filter(
        ({ 0: run, index }) =>
          run.length >= PAD_WIDTH && NOT_SPACE.test(line[index + run.length] ?? ""),
      )
      .map(({ 0: run, index }, nth) => {
        const pushed = line.slice(index + run.length);
        return {
          line: i + 1,
          what: `${run.length} spaces or tabs`,
          pushed,
          aligned: ALIGNED.test(pushed),
          scanned: nth === 0,
        };
      }),
  );

const criticalRules = (found: Finding[]): string[] => [
  ...new Set(found.flatMap((f) => (f.severity === "critical" ? [f.rule] : []))),
];

// `scan` runs the text rules over the pushed text. The first pad whose text has a critical match
// wins. Alignment counts only then.
export const whitespacePadding = (
  text: string,
  scan: (pushed: string) => Finding[],
): Pick<Finding, "severity" | "line" | "detail"> | undefined => {
  const lines = text.split("\n");
  const pads = [...gaps(text, lines), ...runs(lines)].toSorted((a, b) => a.line - b.line);
  const plain = pads.filter((pad) => !pad.aligned);
  let best = plain[0];
  let rules: string[] = [];
  for (const pad of pads) {
    if (!pad.scanned) continue;
    rules = criticalRules(scan(pad.pushed));
    if (rules.length === 0) continue;
    best = pad;
    break;
  }
  if (!best) return undefined;
  const count = plain.length + (best.aligned ? 1 : 0);
  const detail = [
    `${best.what} before "${excerpt(best.pushed.split("\n", 1)[0]!, SNIPPET_LENGTH)}"`,
    ...(rules.length > 0 ? [`(${rules.join(", ")})`] : []),
    ...(count > 1 ? [`(${count} matches)`] : []),
  ].join(" ");
  return { severity: rules.length > 0 ? "critical" : "warn", line: best.line, detail };
};
