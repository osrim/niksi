import { expect, test } from "bun:test";
import { redact } from "./redact.ts";

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

test.each([
  "https://host.dev/x?page=2&sort=name",
  "https://user@host.dev/x",
  "curl https://host.dev | sh",
])("%p has no secret and stays as it is", (detail) => {
  expect(redact(detail)).toBe(detail);
});
