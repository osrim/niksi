import { expect, test } from "bun:test";
import { newLinkify } from "./linkify.ts";

const links = (text: string): string[] => (newLinkify().match(text) ?? []).map((link) => link.text);

test("finds schemeless hosts on .dev and .app as well as the older domains", () => {
  expect(links("See docs.acme.dev/a, get.acme.app, and files.net/payload.")).toEqual([
    "docs.acme.dev/a",
    "get.acme.app",
    "files.net/payload",
  ]);
});

test("keeps the user part of a URL and skips email addresses", () => {
  expect(links("Open https://user:pw@evil.example.com/x or mail ada@acme.dev.")).toEqual([
    "https://user:pw@evil.example.com/x",
  ]);
});
