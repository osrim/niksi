import { expect, test } from "bun:test";
import { keyIndex, keyLine, readJson } from "./manifest.ts";

const text =
  '{\n  "scripts": {\n    "test": "x"\n  },\n  "dependencies": {\n    "test" : "1.0.0"\n  }\n}\n';

test("keyLine finds the first key at or after an offset", () => {
  expect(keyLine(text, "test")).toBe(3);
  expect(keyLine(text, "test", keyIndex(text, "dependencies"))).toBe(6);
  expect(keyLine(text, "x")).toBeUndefined();
  expect(keyIndex(text, "x")).toBe(-1);
});

test("readJson returns an object or the parse error", () => {
  expect(readJson('{"a": 1}')).toEqual({ a: 1 });
  expect(readJson("[1]")).toBeInstanceOf(Error);
  expect(readJson("{")).toBeInstanceOf(Error);
});
