// Token patterns and entropy floors from gitleaks at b58d3f1, MIT License, Copyright (c) 2019 Zachary Rice.
const TOKEN_END = String.raw`(?=[\x60'"\s;]|\\[nr]|$)`;

export interface TokenRule {
  label: string;
  // Group 1 is the token.
  pattern: RegExp;
  // A token at or below this Shannon entropy is skipped.
  entropy?: number;
  // The token counts only when this matches the 40 characters before it.
  near?: RegExp;
  valid?: (token: string) => boolean;
}

const tokenPattern = (source: string, flags = ""): RegExp => new RegExp(source, `g${flags}u`);

const isJsonPart = (part: string): boolean => {
  try {
    const value: unknown = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return typeof value === "object" && value !== null;
  } catch {
    return false;
  }
};

export const TOKEN_RULES: TokenRule[] = [
  {
    label: "AWS access key",
    pattern: tokenPattern(String.raw`\b((?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z2-7]{16})\b`),
    entropy: 3,
    valid: (found) => !found.endsWith("EXAMPLE"),
  },
  {
    label: "GitHub token",
    pattern: tokenPattern(String.raw`\b((?:ghp|gho|ghu|ghs)_[0-9a-zA-Z]{36}|github_pat_\w{82})`),
    entropy: 3,
  },
  {
    label: "Slack token",
    pattern: tokenPattern(String.raw`\b(xoxb-[0-9]{10,13}-[0-9]{10,13}[a-zA-Z0-9-]*)`),
    entropy: 3,
  },
  {
    label: "Slack token",
    pattern: tokenPattern(
      String.raw`\b(xox[pe](?:-[0-9]{10,13}){3}-[a-zA-Z0-9-]{28,34}|xapp-\d-[A-Z0-9]+-\d+-[a-z0-9]+)`,
      "i",
    ),
    entropy: 2,
  },
  {
    label: "Anthropic API key",
    pattern: tokenPattern(
      String.raw`\b(sk-ant-(?:api03|admin01)-[a-zA-Z0-9_\-]{93}AA)${TOKEN_END}`,
    ),
  },
  {
    label: "OpenAI API key",
    pattern: tokenPattern(
      String.raw`\b(sk-(?:proj|svcacct|admin)-(?:[A-Za-z0-9_-]{74}|[A-Za-z0-9_-]{58})T3BlbkFJ(?:[A-Za-z0-9_-]{74}|[A-Za-z0-9_-]{58})\b|sk-[a-zA-Z0-9]{20}T3BlbkFJ[a-zA-Z0-9]{20})${TOKEN_END}`,
    ),
    entropy: 3,
  },
  {
    label: "Stripe live key",
    pattern: tokenPattern(String.raw`\b((?:sk|rk)_live_[a-zA-Z0-9]{10,99})${TOKEN_END}`),
    entropy: 2,
  },
  {
    label: "Google API key",
    pattern: tokenPattern(String.raw`\b(AIza[\w-]{35})${TOKEN_END}`),
    entropy: 4,
  },
  {
    label: "npm token",
    pattern: tokenPattern(String.raw`\b(npm_[a-z0-9]{36})${TOKEN_END}`, "i"),
    entropy: 2,
  },
  {
    label: "PyPI token",
    pattern: tokenPattern(String.raw`(pypi-AgEIcHlwaS5vcmc[\w-]{50,1000})`),
    entropy: 3,
  },
  {
    label: "Hugging Face token",
    pattern: tokenPattern(String.raw`\b(hf_[a-zA-Z]{34})${TOKEN_END}`),
    entropy: 2,
  },
  { label: "GitLab token", pattern: tokenPattern(String.raw`(glpat-[\w-]{20})`), entropy: 3 },
  {
    label: "SendGrid API key",
    pattern: tokenPattern(String.raw`\b(SG\.[a-zA-Z0-9=_\-.]{66})${TOKEN_END}`),
    entropy: 2,
  },
  {
    label: "DigitalOcean token",
    pattern: tokenPattern(String.raw`\b(do[op]_v1_[a-f0-9]{64})${TOKEN_END}`),
    entropy: 3,
  },
  {
    label: "Telegram bot token",
    // gitleaks requires a word boundary and a quote or space after, so it misses a token in a `/bot` URL.
    pattern: tokenPattern(String.raw`(?<![0-9])([0-9]{5,16}:A[a-zA-Z0-9_\-]{34})(?![\w-])`),
    near: /telegram|\/bot/iu,
  },
  {
    label: "Discord bot token",
    pattern: tokenPattern(
      String.raw`[\w.-]{0,50}?discord[ \t\w.-]{0,20}[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-f0-9]{64})${TOKEN_END}`,
      "i",
    ),
  },
  {
    label: "JWT",
    pattern: tokenPattern(
      String.raw`\b(ey[a-zA-Z0-9]{17,}\.ey[a-zA-Z0-9\/\\_-]{17,}\.(?:[a-zA-Z0-9\/\\_-]{10,}={0,2})?)${TOKEN_END}`,
    ),
    entropy: 3,
    valid: (found) => found.split(".").slice(0, 2).every(isJsonPart),
  },
];

const PLACEHOLDER =
  /(.)\1{5}|x{4}|example|sample|dummy|fake|placeholder|redacted|changeme|your|test|abcdef|123456/iu;

export const isPlaceholder = (value: string): boolean =>
  PLACEHOLDER.test(value) || /^\$\{?\w+\}?$|^<[^>]*>$|^\{\{.*\}\}$|^%\w+%$/u.test(value);

export const maskToken = (found: string): string => `${found.slice(0, 4)}…${found.slice(-4)}`;

export const AUTH_HEADER_NAME = String.raw`(?:Authorization:[ \t]*(?:Bearer|Basic|Token)|X-Api-Key:)`;

const AUTH_VALUE = new RegExp(String.raw`(\b${AUTH_HEADER_NAME}[ \t]*)(?!\$)[^\s"']+`, "giu");

const KEY_BLOCK = /(-----BEGIN [ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----)\s*[^-\s][^-]*/gu;

export const maskSecrets = (detail: string, mask: string): string =>
  TOKEN_RULES.reduce(
    (masked, { pattern }) =>
      masked.replace(pattern, (all: string, found: string) => all.replace(found, maskToken(found))),
    detail,
  )
    .replace(KEY_BLOCK, `$1 ${mask}`)
    .replace(AUTH_VALUE, `$1${mask}`);
