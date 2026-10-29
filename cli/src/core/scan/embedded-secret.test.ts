import { expect, test } from "bun:test";
import { embeddedSecrets, isPlaceholder, maskSecrets } from "./embedded-secret.ts";
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

test("placeholders are variables, templates, and filler words", () => {
  for (const value of ["$TOKEN", "${API_KEY}", "<token>", "{{ token }}", "%TOKEN%", "your-key"]) {
    expect(isPlaceholder(value)).toBe(true);
  }
  expect(isPlaceholder("S3cr3tPassw0rd")).toBe(false);
});

test("tokens and key bodies in any detail are masked", () => {
  expect(maskSecrets(`export GH=${GITHUB_TOKEN}`)).toBe("export GH=ghp_…4kVo");
  expect(maskSecrets(PRIVATE_KEY.replaceAll("\n", " "))).toBe(
    "-----BEGIN OPENSSH PRIVATE KEY----- ********-----END OPENSSH PRIVATE KEY-----",
  );
});
