import { expect, test } from "bun:test";
import { isPlaceholder, maskSecrets } from "./secret-patterns.ts";
import { BEARER, GITHUB_TOKEN, PRIVATE_KEY } from "./test-secrets.ts";

test("placeholders are variables, templates, and filler words", () => {
  for (const value of ["$TOKEN", "${API_KEY}", "<token>", "{{ token }}", "%TOKEN%", "your-key"]) {
    expect(isPlaceholder(value)).toBe(true);
  }
  expect(isPlaceholder("S3cr3tPassw0rd")).toBe(false);
});

test("tokens show their ends, and key bodies and header literals are masked", () => {
  expect(maskSecrets(`export GH=${GITHUB_TOKEN}`, "***")).toBe("export GH=ghp_…4kVo");
  expect(maskSecrets(PRIVATE_KEY.replaceAll("\n", " "), "***")).toBe(
    "-----BEGIN OPENSSH PRIVATE KEY----- ***-----END OPENSSH PRIVATE KEY-----",
  );
  expect(maskSecrets(`-H "X-Api-Key: ${BEARER}"`, "***")).toBe('-H "X-Api-Key: ***"');
  expect(maskSecrets('-H "Authorization: Bearer $TOKEN"', "***")).toBe(
    '-H "Authorization: Bearer $TOKEN"',
  );
});
