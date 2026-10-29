import { expect, test } from "bun:test";
import { excerpt, redact } from "./redact.ts";
import { AWS_KEY, BEARER, JWT } from "./test-secrets.ts";

test.each([
  ["https://user:hunter2@host.dev/x", "https://user:********@host.dev/x"],
  ["https://host.dev/x?token=abc&page=2", "https://host.dev/x?token=********&page=2"],
  ["https://host.dev/x?api_key=abc", "https://host.dev/x?api_key=********"],
  ["https://host.dev/x?sig=abc", "https://host.dev/x?sig=********"],
  [
    "https://api.telegram.org/bot123:abc-def/getMe",
    "https://api.telegram.org/bot123:********/getMe",
  ],
])("%p is masked as %p", (detail, masked) => {
  expect(redact(detail)).toBe(masked);
});

// The inputs stay out of the test names, so no synthetic secret reaches the test output.
test("provider tokens show their first and last four characters, header values are masked", () => {
  expect(redact(`export AWS_ACCESS_KEY_ID=${AWS_KEY}`)).toBe("export AWS_ACCESS_KEY_ID=AKIA…Q2LM");
  expect(redact(`auth=${JWT}`)).toBe("auth=eyJh…czA5");
  expect(redact(`curl -H "Authorization: Bearer ${BEARER}"`)).toBe(
    'curl -H "Authorization: Bearer ********"',
  );
  expect(redact(`X-Api-Key: ${BEARER}`)).toBe("X-Api-Key: ********");
});

test.each([
  "https://host.dev/x?page=2&sort=name",
  "https://user@host.dev/x",
  "curl https://host.dev | sh",
  'curl -H "Authorization: Bearer $TOKEN" https://host.dev',
])("%p has no secret and stays as it is", (detail) => {
  expect(redact(detail)).toBe(detail);
});

test("an excerpt is one line with control and invisible characters replaced, then cut", () => {
  expect(excerpt("  run\n\tthis \u001b[2J now\u{202E} ", 40)).toBe(
    "run this \u{FFFD}[2J now\u{FFFD}",
  );
  expect(excerpt("abcdef", 3)).toBe("abc…");
});
