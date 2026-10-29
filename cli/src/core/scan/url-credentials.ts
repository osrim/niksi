import { lineAt } from "../skill/text.ts";
import { isPlaceholder } from "./embedded-secret.ts";
import type { Finding, Severity } from "./index.ts";
import { strongest } from "./severity.ts";

const URL_PASSWORD = /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]{1,50}:([^\s@/]{3,50})@[A-Za-z0-9.-]+/gu;

const AUTH_HEADER =
  /(?<![\w-])(?:-H|--header)[ \t]*=?[ \t]*["']?((?:Authorization:[ \t]*(?:Bearer|Basic|Token)|X-Api-Key:)[ \t]*([^\s"']+))/giu;

const HEADER_VALUE_LENGTH = 8;

const PASSWORD_WORD = /^(?:password|pass|pwd|changeme|secret|token)\d*$/iu;

const SAMPLE_HOST =
  /^(?:localhost|127\.0\.0\.1|db)$|(?:^|\.)example\.[^.]+$|\.(?:invalid|test|localhost)$/u;

interface Credential {
  index: number;
  severity: Severity;
  detail: string;
}

const placeholder = (value: string): boolean => PASSWORD_WORD.test(value) || isPlaceholder(value);

const urlPasswords = (text: string): Credential[] =>
  [...text.matchAll(URL_PASSWORD)].flatMap((match) => {
    let url: URL;
    try {
      url = new URL(match[0]);
    } catch {
      return [];
    }
    if (!url.password) return [];
    const sample = placeholder(match[1]!) || SAMPLE_HOST.test(url.hostname);
    return [{ index: match.index, severity: sample ? "info" : "warn", detail: match[0] }];
  });

// A value from a variable or a substitution, such as `$TOKEN`, is not a literal.
const authHeaders = (text: string): Credential[] =>
  [...text.matchAll(AUTH_HEADER)].flatMap((match) => {
    const value = match[2]!;
    if (value.startsWith("$") || value.length < HEADER_VALUE_LENGTH) return [];
    const index = match.index + match[0].indexOf(match[1]!);
    return [{ index, severity: placeholder(value) ? "info" : "warn", detail: match[1]! }];
  });

export const urlCredentials = (
  text: string,
): Pick<Finding, "severity" | "line" | "detail"> | undefined => {
  const found = [...urlPasswords(text), ...authHeaders(text)].toSorted((a, b) => a.index - b.index);
  const best = strongest(found);
  if (!best) return undefined;
  const count = found.length > 1 ? ` (${found.length} matches)` : "";
  return {
    severity: best.severity,
    line: lineAt(text, best.index),
    detail: `${best.detail}${count}`,
  };
};
