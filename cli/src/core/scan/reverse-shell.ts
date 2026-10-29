import type { ProseJudge } from "./context.ts";
import type { Finding } from "./index.ts";
import {
  oncePerLine,
  patternMatch,
  statementMatch,
  strongestLine,
  type LineMatch,
} from "./line-match.ts";
import type { Statement } from "./shell.ts";

const PATTERNS = [
  /\b(?:ba|z|da)?sh\s+-i\s*>?&\s*\/dev\/(?:tcp|udp)\/[^\s]*/gu,
  /\/dev\/(?:tcp|udp)\/[\w.-]+\/\d{1,5}/gu,
  /\b(?:nc|ncat|netcat)\b[^\n|]*\s-[ec]\s+["']?\/bin\/(?:ba|z)?sh\b/gu,
  /\bmkfifo\s+\S+[^\n]*\|\s*(?:\/bin\/)?(?:ba)?sh\s+-i\b/gu,
  /\bsocat\b[^\n]*\b(?:exec|system):/giu,
  /\bpython[\d.]*\s+-c\s+[^\n]*\bsocket\b[^\n]*\bconnect\s*\(/gu,
  /\bpty\.spawn\(\s*["'](?:\/bin\/)?(?:ba|z)?sh["']\s*\)/gu,
  /\bphp\s+-r\s+[^\n]*\bfsockopen\s*\(/gu,
  /\bruby\s+-rsocket\s+-e\b/gu,
  /\b(?:powershell|pwsh)(?:\.exe)?\b[^\n]*?\s-(?:e|enc|encodedcommand)\s+["']?[a-z\d+/]{20,}/giu,
];

// Quoting such as n'c' hides a command from the raw text, so each command's unquoted words match too.
const commandMatches = (statements: Statement[], judge: ProseJudge): LineMatch[] =>
  statements.flatMap((statement) =>
    statement.commands.flatMap((command) => {
      const words = command.words.join(" ");
      return PATTERNS.flatMap((pattern) =>
        Array.from(words.matchAll(pattern), (match) =>
          statementMatch(statement, judge, "critical", match[0]),
        ),
      );
    }),
  );

export const reverseShell = (
  text: string,
  statements: Statement[],
  judge: ProseJudge,
): Pick<Finding, "severity" | "line" | "detail"> | undefined => {
  const at = patternMatch(text, statements, judge);
  return strongestLine(
    oncePerLine([
      ...PATTERNS.flatMap((pattern) =>
        Array.from(text.matchAll(pattern), (match) => at(match.index, match[0], "critical")),
      ),
      ...commandMatches(statements, judge),
    ]),
  );
};
