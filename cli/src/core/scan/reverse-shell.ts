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
import { everyMatch, greedyChain, lazyChain, perLine, token, type Finder } from "./token-chain.ts";

const PATTERNS: Finder[] = [
  everyMatch(/\b(?:ba|z|da)?sh\s+-i\s*>?&\s*\/dev\/(?:tcp|udp)\/[^\s]*/gu),
  everyMatch(/\/dev\/(?:tcp|udp)\/[\w.-]+\/\d{1,5}/gu),
  perLine(
    greedyChain([token(/\b(?:nc|ncat|netcat)\b/u)], /\s-[ec]\s+["']?\/bin\/(?:ba|z)?sh\b/u),
    /[^\n|]+/gu,
  ),
  perLine(greedyChain([token(/\bmkfifo\s+\S/u)], /\|\s*(?:\/bin\/)?(?:ba)?sh\s+-i\b/u)),
  perLine(greedyChain([token(/\bsocat\b/iu)], /\b(?:exec|system):/iu)),
  perLine(greedyChain([token(/\bpython[\d.]*\s+-c\s+/u), token(/\bsocket\b/u)], /\bconnect\s*\(/u)),
  everyMatch(/\bpty\.spawn\(\s*["'](?:\/bin\/)?(?:ba|z)?sh["']\s*\)/gu),
  perLine(greedyChain([token(/\bphp\s+-r\s+/u)], /\bfsockopen\s*\(/u)),
  everyMatch(/\bruby\s+-rsocket\s+-e\b/gu),
  perLine(
    lazyChain(
      token(/\b(?:powershell|pwsh)(?:\.exe)?\b/iu),
      token(/\s-(?:e|enc|encodedcommand)\s+["']?[a-z\d+/]{20,}/iu),
    ),
  ),
];

// Quoting such as n'c' hides a command from the raw text, so each command's unquoted words match too.
const commandMatches = (statements: Statement[], judge: ProseJudge): LineMatch[] =>
  statements.flatMap((statement) =>
    statement.commands.flatMap((command) => {
      const words = command.words.join(" ");
      return PATTERNS.flatMap((find) =>
        find(words).map((found) => statementMatch(statement, judge, "critical", found.text)),
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
      ...PATTERNS.flatMap((find) =>
        find(text).map((found) => at(found.index, found.text, "critical")),
      ),
      ...commandMatches(statements, judge),
    ]),
  );
};
