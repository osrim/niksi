import { expect, test } from "bun:test";
import { slowdown } from "../../test-timing.ts";
import { anyOf, everyMatch, greedyChain, lazyChain, perLine, token } from "./token-chain.ts";

const a = token(/\ba\b/u);
const b = token(/\bb\b/u);

test("a lazy chain ends at the first match of its last token, as a[^\\n]*?b does", () => {
  expect(perLine(lazyChain(a, b))("x a y b z b")).toEqual([{ index: 2, text: "a y b" }]);
  expect(perLine(lazyChain(a, b))("b a")).toEqual([]);
});

test("a greedy chain ends at the last match of its last token, as a[^\\n]*b does", () => {
  expect(perLine(greedyChain([a], /\bb\b/u))("x a y b z b")).toEqual([
    { index: 2, text: "a y b z b" },
  ]);
  expect(perLine(greedyChain([a, b], /\bc\b/u))("a c b c b c x")).toEqual([
    { index: 0, text: "a c b c b c" },
  ]);
  expect(perLine(greedyChain([a, b], /\bc\b/u))("a c b")).toEqual([]);
});

test("a chain stays on one line and reports the first match of each line", () => {
  expect(perLine(lazyChain(a, b))("a\nb")).toEqual([]);
  expect(perLine(lazyChain(a, b))("a b a b\nz a b")).toEqual([
    { index: 0, text: "a b" },
    { index: 10, text: "a b" },
  ]);
});

test("a segment pattern stops a chain at its boundaries", () => {
  const unpiped = perLine(lazyChain(a, b), /[^\n|]+/gu);
  expect(unpiped("a | b")).toEqual([]);
  expect(unpiped("a x | a b")).toEqual([{ index: 6, text: "a b" }]);
});

test("anyOf takes the match that starts first, and the first token listed on a tie", () => {
  const ab = token(/a b/u);
  expect(perLine(anyOf(b, a))("a b")).toEqual([{ index: 0, text: "a" }]);
  expect(perLine(anyOf(ab, a))("a b")).toEqual([{ index: 0, text: "a b" }]);
  expect(perLine(anyOf(a, ab))("a b")).toEqual([{ index: 0, text: "a" }]);
});

test("a token sees the text before its start, as a regex does", () => {
  expect(perLine(lazyChain(a, token(/(?<!x)b/u)))("a xb b")).toEqual([
    { index: 0, text: "a xb b" },
  ]);
});

test("everyMatch reports each match of a pattern", () => {
  expect(everyMatch(/\ba\b/gu)("a b a")).toEqual([
    { index: 0, text: "a" },
    { index: 4, text: "a" },
  ]);
});

test("a long line of first tokens with no last token scans in linear time", () => {
  const chain = perLine(greedyChain([a, b], /\bc\b/u));
  const { ratio, rounds } = slowdown(
    () => chain("a b ".repeat(50_000)),
    () => chain("a b\n".repeat(50_000)),
  );
  expect(ratio, rounds).toBeLessThan(3);
});
