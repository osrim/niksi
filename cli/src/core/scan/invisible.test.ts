import { expect, test } from "bun:test";
import { invisibleCharacters } from "./invisible.ts";

test("a character within two lines of a prompt-injection match is critical", () => {
  const text = "line one \u{200B}\nline two\nline three\nline four\n";
  expect(invisibleCharacters(text, [{ line: 3 }])?.severity).toBe("critical");
  expect(invisibleCharacters(text, [{ line: 4 }])?.severity).toBe("warn");
});

test("the strongest character leads the detail and sets the line", () => {
  expect(invisibleCharacters("soft\u{AD}hyphen\nthen \u{200B}\nand a\u{202E}b\n", [])).toEqual({
    severity: "critical",
    line: 3,
    detail: "3 invisible character(s): U+202E (bidi control), U+200B, U+00AD (soft hyphen)",
  });
});

test("a tag run outside a flag decodes, even after a black flag without a cancel tag", () => {
  const run = [..."hi"].map((ch) => String.fromCodePoint(0xe0000 + ch.codePointAt(0)!)).join("");
  expect(invisibleCharacters(`\u{1F3F4}${run}`, [])?.detail).toBe(
    '2 invisible character(s): U+E0068…U+E0069 (tags decode to "hi")',
  );
});
