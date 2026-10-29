import { lineAt } from "../skill/text.ts";
import { combine } from "./combine.ts";
import type { Finding, Severity } from "./index.ts";
import { strongest } from "./severity.ts";

// Token patterns and entropy floors from gitleaks at b58d3f1, MIT License, Copyright (c) 2019 Zachary Rice.
const END = String.raw`(?=[\x60'"\s;]|\\[nr]|$)`;

interface TokenRule {
  label: string;
  // Group 1 is the token.
  pattern: RegExp;
  // A token at or below this Shannon entropy is skipped.
  entropy?: number;
  // The token counts only when this matches the 40 characters before it.
  near?: RegExp;
  valid?: (token: string) => boolean;
}

const token = (source: string, flags = ""): RegExp => new RegExp(source, `g${flags}u`);

const isJsonPart = (part: string): boolean => {
  try {
    const value: unknown = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return typeof value === "object" && value !== null;
  } catch {
    return false;
  }
};

const TOKEN_RULES: TokenRule[] = [
  {
    label: "AWS access key",
    pattern: token(String.raw`\b((?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z2-7]{16})\b`),
    entropy: 3,
    valid: (found) => !found.endsWith("EXAMPLE"),
  },
  {
    label: "GitHub token",
    pattern: token(String.raw`\b((?:ghp|gho|ghu|ghs)_[0-9a-zA-Z]{36}|github_pat_\w{82})`),
    entropy: 3,
  },
  {
    label: "Slack token",
    pattern: token(String.raw`\b(xoxb-[0-9]{10,13}-[0-9]{10,13}[a-zA-Z0-9-]*)`),
    entropy: 3,
  },
  {
    label: "Slack token",
    pattern: token(
      String.raw`\b(xox[pe](?:-[0-9]{10,13}){3}-[a-zA-Z0-9-]{28,34}|xapp-\d-[A-Z0-9]+-\d+-[a-z0-9]+)`,
      "i",
    ),
    entropy: 2,
  },
  {
    label: "Anthropic API key",
    pattern: token(String.raw`\b(sk-ant-(?:api03|admin01)-[a-zA-Z0-9_\-]{93}AA)${END}`),
  },
  {
    label: "OpenAI API key",
    pattern: token(
      String.raw`\b(sk-(?:proj|svcacct|admin)-(?:[A-Za-z0-9_-]{74}|[A-Za-z0-9_-]{58})T3BlbkFJ(?:[A-Za-z0-9_-]{74}|[A-Za-z0-9_-]{58})\b|sk-[a-zA-Z0-9]{20}T3BlbkFJ[a-zA-Z0-9]{20})${END}`,
    ),
    entropy: 3,
  },
  {
    label: "Stripe live key",
    pattern: token(String.raw`\b((?:sk|rk)_live_[a-zA-Z0-9]{10,99})${END}`),
    entropy: 2,
  },
  {
    label: "Google API key",
    pattern: token(String.raw`\b(AIza[\w-]{35})${END}`),
    entropy: 4,
  },
  { label: "npm token", pattern: token(String.raw`\b(npm_[a-z0-9]{36})${END}`, "i"), entropy: 2 },
  {
    label: "PyPI token",
    pattern: token(String.raw`(pypi-AgEIcHlwaS5vcmc[\w-]{50,1000})`),
    entropy: 3,
  },
  {
    label: "Hugging Face token",
    pattern: token(String.raw`\b(hf_[a-zA-Z]{34})${END}`),
    entropy: 2,
  },
  { label: "GitLab token", pattern: token(String.raw`(glpat-[\w-]{20})`), entropy: 3 },
  {
    label: "SendGrid API key",
    pattern: token(String.raw`\b(SG\.[a-zA-Z0-9=_\-.]{66})${END}`),
    entropy: 2,
  },
  {
    label: "DigitalOcean token",
    pattern: token(String.raw`\b(do[op]_v1_[a-f0-9]{64})${END}`),
    entropy: 3,
  },
  {
    label: "Telegram bot token",
    pattern: token(String.raw`\b([0-9]{5,16}:A[a-zA-Z0-9_\-]{34})${END}`),
    near: /telegram|\/bot/iu,
  },
  {
    label: "Discord bot token",
    pattern: token(
      String.raw`[\w.-]{0,50}?discord[ \t\w.-]{0,20}[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-f0-9]{64})${END}`,
      "i",
    ),
  },
  {
    label: "JWT",
    pattern: token(
      String.raw`\b(ey[a-zA-Z0-9]{17,}\.ey[a-zA-Z0-9\/\\_-]{17,}\.(?:[a-zA-Z0-9\/\\_-]{10,}={0,2})?)${END}`,
    ),
    entropy: 3,
    valid: (found) => found.split(".").slice(0, 2).every(isJsonPart),
  },
];

const PRIVATE_KEY =
  /-----BEGIN ([ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?)-----([\s\S]*?)-----END [ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----/gu;

const KEY_BODY_LENGTH = 64;

const PLACEHOLDER =
  /(.)\1{5}|x{4}|example|sample|dummy|fake|placeholder|redacted|changeme|your|test|abcdef|123456/iu;
const ELIDED_KEY = /\.\.\.|…|<|example|redacted|placeholder|your/iu;

export const isPlaceholder = (value: string): boolean =>
  PLACEHOLDER.test(value) || /^\$\{?\w+\}?$|^<[^>]*>$|^\{\{.*\}\}$|^%\w+%$/u.test(value);

const shannon = (text: string): number => {
  const counts = new Map<string, number>();
  for (const ch of text) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  return [...counts.values()].reduce(
    (sum, n) => sum - (n / text.length) * Math.log2(n / text.length),
    0,
  );
};

export const maskToken = (found: string): string => `${found.slice(0, 4)}…${found.slice(-4)}`;

interface Secret {
  index: number;
  line: number;
  detail: string;
}

const tokens = (text: string): Secret[] =>
  TOKEN_RULES.flatMap(({ label, pattern, entropy = 0, near, valid }) =>
    [...text.matchAll(pattern)].flatMap((match) => {
      const found = match[1]!;
      const index = match.index + match[0].indexOf(found);
      if (near && !near.test(text.slice(Math.max(0, index - 40), index))) return [];
      if (shannon(found) <= entropy || isPlaceholder(found) || valid?.(found) === false) return [];
      return [{ index, line: lineAt(text, index), detail: `${label} ${maskToken(found)}` }];
    }),
  );

const privateKeys = (text: string): Secret[] =>
  [...text.matchAll(PRIVATE_KEY)].flatMap((match) => {
    const body = match[2]!;
    if (body.replaceAll(/\s/gu, "").length < KEY_BODY_LENGTH || ELIDED_KEY.test(body)) return [];
    const lines = match[0].split("\n").length;
    return [
      {
        index: match.index,
        line: lineAt(text, match.index),
        detail: `${match[1]} block (${lines} lines)`,
      },
    ];
  });

const SEND_DISTANCE = 5;

// A secret is critical when a line within five lines sends something over the network.
export const embeddedSecrets = (
  text: string,
  sendLines: readonly number[],
): Pick<Finding, "severity" | "line" | "detail"> | undefined => {
  const found = [...tokens(text), ...privateKeys(text)].toSorted((a, b) => a.index - b.index);
  const sends = sendLines.map((line) => ({ line }));
  const pairs = new Map(
    combine(found, sends, { within: SEND_DISTANCE }).map(({ anchor, partner }) => [
      anchor,
      partner.line,
    ]),
  );
  const judged = found.map((secret) => {
    const send = pairs.get(secret);
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

const KEY_BLOCK = /(-----BEGIN [ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----)\s*[^-\s][^-]*/gu;

export const maskSecrets = (detail: string): string =>
  TOKEN_RULES.reduce(
    (masked, { pattern }) =>
      masked.replace(pattern, (all: string, found: string) => all.replace(found, maskToken(found))),
    detail,
  ).replace(KEY_BLOCK, "$1 ********");
