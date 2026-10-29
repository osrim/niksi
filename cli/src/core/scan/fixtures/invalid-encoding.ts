import { entry, type Case } from "../test-fixture.ts";

const latin1 = (text: string): Uint8Array => Buffer.from(text, "latin1");

export default [
  {
    name: "L02 a Latin-1 SKILL.md",
    path: "SKILL.md",
    content: latin1(entry("Order a caf\xE9.")),
    fire: [{ severity: "critical", detail: "not UTF-8 at byte 50" }],
  },
  {
    name: "L02 a UTF-16LE SKILL.md without a byte order mark",
    path: "SKILL.md",
    content: Buffer.from(entry("Order a café."), "utf16le"),
    fire: [{ severity: "critical", detail: "not UTF-8 at byte 100, read as UTF-16LE" }],
  },
  {
    name: "a Latin-1 script",
    path: "scripts/run.py",
    content: latin1("print('caf\xE9')\n"),
    fire: [{ severity: "warn", detail: "not UTF-8 at byte 10" }],
  },
  {
    name: "L02 a Latin-1 LICENSE.txt",
    path: "LICENSE.txt",
    content: latin1("Copyright (c) Jos\xE9\n"),
    fire: [{ severity: "info" }],
  },
  {
    name: "the same SKILL.md as UTF-8",
    path: "SKILL.md",
    content: entry("Order a café."),
    silent: "none",
  },
  {
    name: "a UTF-8 SKILL.md with a byte order mark",
    path: "SKILL.md",
    content: `\uFEFF${entry("Order a café.")}`,
    silent: "none",
  },
  {
    name: "a binary file is not text",
    path: "assets/logo.png",
    content: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xe9]),
    silent: "none",
  },
] satisfies Case[];
