import { lineOf, lineStarts } from "../skill/text.ts";
import type { Finding, Severity } from "./index.ts";
import { isPlaceholder, maskToken, TOKEN_RULES } from "./secret-patterns.ts";
import { strongest } from "./severity.ts";

const PRIVATE_KEY =
  /-----BEGIN ([ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?)-----([\s\S]{0,20000}?)-----END [ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----/gu;

const KEY_BODY_LENGTH = 64;

const ELIDED_KEY = /\.\.\.|…|<|example|redacted|placeholder|your/iu;

const shannon = (text: string): number => {
  const counts = new Map<string, number>();
  for (const ch of text) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  return [...counts.values()].reduce(
    (sum, n) => sum - (n / text.length) * Math.log2(n / text.length),
    0,
  );
};

const CUE_DISTANCE = 40;

// Each side is tested alone, so a cue cannot be spelled across the token.
const hasCue = (near: RegExp, text: string, index: number, length: number): boolean =>
  near.test(text.slice(Math.max(0, index - CUE_DISTANCE), index)) ||
  near.test(text.slice(index + length, index + length + CUE_DISTANCE));

interface Secret {
  index: number;
  line: number;
  // A private key spans lines. A send counts from its BEGIN line or its END line.
  lastLine: number;
  detail: string;
}

const tokens = (text: string, lineAt: (index: number) => number): Secret[] =>
  TOKEN_RULES.flatMap(({ label, pattern, entropy = 0, near, valid }) =>
    [...text.matchAll(pattern)].flatMap((match) => {
      const found = match[1]!;
      const index = match.index + match[0].indexOf(found);
      if (near && !hasCue(near, text, index, found.length)) return [];
      if (shannon(found) <= entropy || isPlaceholder(found) || valid?.(found) === false) return [];
      const line = lineAt(index);
      return [{ index, line, lastLine: line, detail: `${label} ${maskToken(found)}` }];
    }),
  );

const privateKeys = (text: string, lineAt: (index: number) => number): Secret[] =>
  [...text.matchAll(PRIVATE_KEY)].flatMap((match) => {
    const body = match[2]!;
    if (body.replaceAll(/\s/gu, "").length < KEY_BODY_LENGTH || ELIDED_KEY.test(body)) return [];
    const lines = match[0].split("\n").length;
    return [
      {
        index: match.index,
        line: lineAt(match.index),
        lastLine: lineAt(match.index + match[0].length),
        detail: `${match[1]} block (${lines} lines)`,
      },
    ];
  });

const SEND_DISTANCE = 5;

// `sends` is in line order. A tie goes to the earlier send.
const nearestSend = (sends: readonly number[], line: number): number | undefined => {
  let lo = 0;
  let hi = sends.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (sends[mid]! < line) lo = mid + 1;
    else hi = mid;
  }
  const before = sends[lo - 1];
  const after = sends[lo];
  const nearest =
    before !== undefined && (after === undefined || line - before <= after - line) ? before : after;
  return nearest !== undefined && Math.abs(nearest - line) <= SEND_DISTANCE ? nearest : undefined;
};

export const embeddedSecrets = (
  text: string,
  sendLines: readonly number[],
): Pick<Finding, "severity" | "line" | "detail"> | undefined => {
  const starts = lineStarts(text);
  const lineAt = (index: number): number => lineOf(starts, index) + 1;
  const found = [...tokens(text, lineAt), ...privateKeys(text, lineAt)].toSorted(
    (a, b) => a.index - b.index,
  );
  const sends = sendLines.toSorted((a, b) => a - b);
  const judged = found.map((secret) => {
    const send = nearestSend(sends, secret.line) ?? nearestSend(sends, secret.lastLine);
    const severity: Severity = send === undefined ? "warn" : "critical";
    return { secret, severity, send };
  });
  const best = strongest(judged);
  if (!best) return undefined;
  const detail = [
    best.secret.detail,
    ...(best.send === undefined ? [] : [`(network call on line ${best.send})`]),
    ...(judged.length > 1 ? [`(${judged.length} matches)`] : []),
  ].join(" ");
  return { severity: best.severity, line: best.secret.line, detail };
};
