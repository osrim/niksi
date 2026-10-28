import type { Hidden, HiddenKind } from "../skill/markdown.ts";
import type { Finding, Severity } from "./index.ts";
import { excerpt } from "./redact.ts";
import { stronger } from "./severity.ts";

const KIND: Record<HiddenKind, string> = {
  comment: "HTML comment",
  element: "hidden element",
  attribute: "alt or title text",
  definition: "link definition title",
};

const URL_TEXT = /\bhttps?:\/\/\S|\bwww\.\S/iu;
const COMMAND =
  /^\s*(?:\$\s+)?(?:sudo|rm|chmod|curl|wget|bash|sh|zsh|eval|npx|iex|powershell)\s+\S|\b(?:curl|wget)\s+\S|`[^`\n]+`|\$\(|\|\s*(?:ba|z)?sh\b/mu;

// Shorter hidden text is usually a note. A tool directive is never long text.
const LONG_TEXT = 40;
const DIRECTIVE = /^(?:markdownlint-|prettier-ignore|cspell:|textlint-|vale )/u;
const SNIPPET_LENGTH = 80;

interface Judged {
  hidden: Hidden;
  body: string;
  severity: Severity;
  rules: string[];
}

const judge = (
  hidden: Hidden,
  body: string,
  scan: (body: string) => Finding[],
): Judged | undefined => {
  const rules = [...new Set(scan(body).flatMap((f) => (f.severity === "info" ? [] : [f.rule])))];
  if (rules.length > 0) return { hidden, body, severity: "critical", rules };
  if (URL_TEXT.test(body) || COMMAND.test(body)) return { hidden, body, severity: "warn", rules };
  if (body.length >= LONG_TEXT && !DIRECTIVE.test(body))
    return { hidden, body, severity: "info", rules };
  return undefined;
};

// `scan` runs the text rules over one hidden text.
export const hiddenHtml = (
  text: string,
  hidden: Hidden[],
  scan: (body: string) => Finding[],
): Pick<Finding, "severity" | "line" | "detail"> | undefined => {
  const judged = hidden.flatMap((span) => {
    const body = text.slice(span.start, span.end).trim();
    return (body && judge(span, body, scan)) || [];
  });
  const best = judged.reduce<Judged | undefined>(
    (a, b) => (!a || stronger(b.severity, a.severity) ? b : a),
    undefined,
  );
  if (!best) return undefined;
  const detail = [
    `${KIND[best.hidden.kind]}: "${excerpt(best.body, SNIPPET_LENGTH)}"`,
    ...(best.rules.length > 0 ? [`(${best.rules.join(", ")})`] : []),
    ...(judged.length > 1 ? [`(${judged.length} hidden texts)`] : []),
  ].join(" ");
  return { severity: best.severity, line: best.hidden.line, detail };
};
