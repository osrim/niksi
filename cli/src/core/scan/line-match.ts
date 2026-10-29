import { lineAt } from "../skill/text.ts";
import { judgeIndex, judgeStatement, type ProseJudge } from "./context.ts";
import type { Finding, Severity } from "./index.ts";
import { matchDetail } from "./redact.ts";
import { strongest } from "./severity.ts";
import type { Statement } from "./shell.ts";

export interface LineMatch {
  severity: Severity;
  line: number;
  // Offset in the scanned text, for text order.
  index: number;
  // What the finding quotes.
  text: string;
  quiet: boolean;
}

export const statementMatch = (
  statement: Statement,
  judge: ProseJudge,
  severity: Severity,
  text = statement.text,
): LineMatch => {
  const { quiet, judged } = judgeStatement(statement, judge);
  return { severity: judged(severity), line: statement.line, index: statement.index, text, quiet };
};

export const patternMatch =
  (text: string, statements: readonly Statement[], judge: ProseJudge) =>
  (index: number, found: string, severity: Severity): LineMatch => {
    const { quiet, judged } = judgeIndex(statements, index, judge);
    return { severity: judged(severity), line: lineAt(text, index), index, text: found, quiet };
  };

// A line can match more than one pattern, so only its first match in text order counts.
export const oncePerLine = <T extends LineMatch>(matches: readonly T[]): T[] => {
  const lines = new Set<number>();
  return matches
    .toSorted((a, b) => a.index - b.index)
    .filter(({ line }) => {
      if (lines.has(line)) return false;
      lines.add(line);
      return true;
    });
};

export const strongestLine = (
  found: readonly LineMatch[],
): Pick<Finding, "severity" | "line" | "detail"> | undefined => {
  const best = strongest(found);
  if (!best) return undefined;
  return {
    severity: best.severity,
    line: best.line,
    detail: matchDetail(best.text, best.quiet, found.length),
  };
};
