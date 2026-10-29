import { lineAt } from "../skill/text.ts";
import { oncePerLine } from "./combine.ts";
import { judgeIndex, type ProseJudge } from "./context.ts";
import type { Finding } from "./index.ts";
import { matchDetail } from "./redact.ts";
import { strongest } from "./severity.ts";
import type { Statement } from "./shell.ts";

const PATTERNS = [
  /\b(?:ba|z|da)?sh\s+-i\s*>?&\s*\/dev\/(?:tcp|udp)\/[^\s]*/gu,
  /\/dev\/(?:tcp|udp)\/[\w.-]+\/\d{1,5}/gu,
  /\b(?:nc|ncat|netcat)\b[^\n|]*\s-[ec]\s+\/bin\/(?:ba|z)?sh\b/gu,
  /\bmkfifo\s+\S+[^\n]*\|\s*(?:\/bin\/)?(?:ba)?sh\s+-i\b/gu,
  /\bsocat\b[^\n]*\b(?:exec|system):/giu,
  /\bpython[\d.]*\s+-c\s+[^\n]*\bsocket\b[^\n]*\bconnect\s*\(/gu,
  /\bpty\.spawn\(\s*["'](?:\/bin\/)?(?:ba|z)?sh["']\s*\)/gu,
  /\bphp\s+-r\s+[^\n]*\bfsockopen\s*\(/gu,
  /\bruby\s+-rsocket\s+-e\b/gu,
  /\b(?:powershell|pwsh)(?:\.exe)?\b[^\n]*?\s-(?:e|enc|encodedcommand)\s+["']?[a-z\d+/]{20,}/giu,
];

export const reverseShell = (
  text: string,
  statements: Statement[],
  judge: ProseJudge,
): Pick<Finding, "severity" | "line" | "detail"> | undefined => {
  const found = oncePerLine(
    PATTERNS.flatMap((pattern) => Array.from(text.matchAll(pattern)))
      .toSorted((a, b) => a.index - b.index)
      .map((match) => {
        const { quiet, judged } = judgeIndex(statements, match.index, judge);
        return { severity: judged("critical"), line: lineAt(text, match.index), match, quiet };
      }),
  );
  const best = strongest(found);
  if (!best) return undefined;
  return {
    severity: best.severity,
    line: best.line,
    detail: matchDetail(best.match[0], best.quiet, found.length),
  };
};
