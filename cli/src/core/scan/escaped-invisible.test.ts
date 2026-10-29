import { expect, test } from "bun:test";
import { escapedInvisibles } from "./escaped-invisible.ts";

test("four escaped tag characters are critical and the detail decodes them", () => {
  expect(
    escapedInvisibles('ok\nconst marker = "\\u{E0069}\\u{E0067}\\u{E006E}\\u{E006F}";\n'),
  ).toEqual({
    severity: "critical",
    line: 2,
    detail: '4 escaped invisible character(s): U+E0069…U+E006F (tags decode to "igno")',
  });
});

test("tag characters count across the file, and control tags show escaped", () => {
  const found = escapedInvisibles(
    'a = "\\U000E0068\\U000E0001"\nb = "\\U000E0069" + "\\U000E0021\\U000E0021"\n',
  );
  expect(found?.severity).toBe("critical");
  expect(found?.detail).toBe(
    '5 escaped invisible character(s): U+E0068…U+E0001, U+E0069, U+E0021…U+E0021 (tags decode to "h\\x01i!!")',
  );
});

test("three printable tag characters stay at warn, however many control tags join them", () => {
  expect(escapedInvisibles('"\\u{E0069}\\u{E0067}\\u{E006E}"')?.severity).toBe("warn");
  expect(escapedInvisibles('"\\u{E007F}\\u{E007F}\\u{E007F}\\u{E007F}\\u{E0069}"')?.severity).toBe(
    "warn",
  );
});

test("every escape form resolves its code point", () => {
  for (const escape of [
    "\\u200B",
    "\\u{200b}",
    "\\U0000200B",
    "&#x200B;",
    "&#8203;",
    "%E2%80%8B",
  ]) {
    expect(escapedInvisibles(`word ${escape} here`)).toEqual({
      severity: "warn",
      line: 1,
      detail: "1 escaped invisible character(s): U+200B",
    });
  }
});

test("a surrogate pair decodes to one tag character", () => {
  expect(escapedInvisibles('"\\uDB40\\uDC69"')?.detail).toBe(
    '1 escaped invisible character(s): U+E0069 (tags decode to "i")',
  );
});

test("a bidi control or a character between letters is capped at warn", () => {
  expect(escapedInvisibles('"user\\u202E admin"')?.severity).toBe("warn");
  expect(escapedInvisibles("ig&#8203;nore")?.severity).toBe("warn");
});

test("a soft hyphen is info", () => {
  expect(escapedInvisibles("hy&#173;phen")?.severity).toBe("info");
});

test("visible escapes, emoji joiners, and flag tags are not findings", () => {
  expect(escapedInvisibles('"caf\\u00e9" %20 &#65; \\u{1F468}\\u200D\\u{1F469}')).toBeUndefined();
  expect(
    escapedInvisibles("\\u{1F3F4}\\u{E0067}\\u{E0062}\\u{E0073}\\u{E0063}\\u{E0074}\\u{E007F}"),
  ).toBeUndefined();
});

test("a line with a test cue is skipped, and only that line", () => {
  expect(escapedInvisibles('expect(strip("\\u200B")).toBe("")')).toBeUndefined();
  expect(escapedInvisibles('assertEqual(x, "\\u200B")\nisTest("\\u200B")')).toBeUndefined();
  expect(escapedInvisibles('// test\nconst zwsp = "\\u200B";')?.line).toBe(2);
});

test("a literal invisible character is left to invisible-unicode", () => {
  expect(escapedInvisibles("plain \u{200B} text &amp;")).toBeUndefined();
});

test("an escape after an escaped backslash is literal text", () => {
  const tags = "\\u{E0069}\\u{E0067}\\u{E006E}\\u{E006F}";
  expect(escapedInvisibles(`doc = "${tags.replaceAll("\\u", "\\\\u")}"`)).toBeUndefined();
  expect(escapedInvisibles(`doc = "${tags.replaceAll("\\u", "\\\\\\u")}"`)?.severity).toBe(
    "critical",
  );
});

test("a very long line decodes without overflowing the call stack", () => {
  expect(escapedInvisibles(`x = "${"a".repeat(1_000_000)}\\u200B"`)?.severity).toBe("warn");
});
