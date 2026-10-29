import { expect, test } from "bun:test";
import { decodeText, MODE_FILE } from "../skill/files.ts";
import { invalidEncoding } from "./encoding.ts";

const scan = (path: string, content: Buffer) => {
  const file = { path, content, mode: MODE_FILE };
  return invalidEncoding(file, decodeText(file));
};

const latin1 = Buffer.from("caf\xE9\n", "latin1");

test("the severity follows what reads the file", () => {
  expect(scan("SKILL.md", latin1)).toEqual({
    severity: "critical",
    detail: "not UTF-8 at byte 3",
  });
  expect(scan("docs/notes.md", latin1)?.severity).toBe("warn");
  expect(scan("scripts/run.py", latin1)?.severity).toBe("warn");
  expect(scan("bin/run", Buffer.from("#!/bin/sh\n# caf\xE9\n", "latin1"))?.severity).toBe("warn");
  expect(scan("LICENSE.txt", latin1)?.severity).toBe("info");
  expect(scan("config.json", latin1)?.severity).toBe("info");
});

test("a file read as UTF-16LE says so", () => {
  expect(scan("SKILL.md", Buffer.from("café\n", "utf16le"))).toEqual({
    severity: "critical",
    detail: "not UTF-8 at byte 6, read as UTF-16LE",
  });
});

test("valid UTF-8 and binary files are silent", () => {
  expect(scan("SKILL.md", Buffer.from("café\n"))).toBeUndefined();
  expect(scan("logo.png", Buffer.from([0x89, 0x50, 0x00, 0xe9]))).toBeUndefined();
});
