import { expect, test } from "bun:test";
import { slowdown } from "../../test-timing.ts";
import { anyOf, everyMatch, greedyChain, lazyChain, perSegment, token } from "./token-chain.ts";

const a = token(/\ba\b/u);
const b = token(/\bb\b/u);
const c = token(/\bc\b/u);

test("a lazy chain ends at the first match of its last token, as a[^\\n]*?b does", () => {
  expect(perSegment(lazyChain(a, b))("x a y b z b")).toEqual([{ index: 2, text: "a y b" }]);
  expect(perSegment(lazyChain(a, b))("b a")).toEqual([]);
});

test("a greedy chain ends at the last match of its last token, as a[^\\n]*b does", () => {
  expect(perSegment(greedyChain(a, b))("x a y b z b")).toEqual([{ index: 2, text: "a y b z b" }]);
  expect(perSegment(greedyChain(a, b, c))("a c b c b c x")).toEqual([
    { index: 0, text: "a c b c b c" },
  ]);
  expect(perSegment(greedyChain(a, b, c))("a c b")).toEqual([]);
});

test("a chain stays on one line and reports each match, from where the last one ended", () => {
  expect(perSegment(lazyChain(a, b))("a\nb")).toEqual([]);
  expect(perSegment(lazyChain(a, b))("a b a b\nz a b")).toEqual([
    { index: 0, text: "a b" },
    { index: 4, text: "a b" },
    { index: 10, text: "a b" },
  ]);
});

test("a segment pattern stops a chain at its boundaries", () => {
  const unpiped = perSegment(lazyChain(a, b), /[^\n|]+/gu);
  expect(unpiped("a | b")).toEqual([]);
  expect(unpiped("a x | a b")).toEqual([{ index: 6, text: "a b" }]);
});

test("anyOf takes the match that starts first, and the first token listed on a tie", () => {
  const ab = token(/a b/u);
  expect(perSegment(anyOf(b, a))("a b").at(0)).toEqual({ index: 0, text: "a" });
  expect(perSegment(anyOf(ab, a))("a b").at(0)).toEqual({ index: 0, text: "a b" });
  expect(perSegment(anyOf(a, ab))("a b").at(0)).toEqual({ index: 0, text: "a" });
});

test("a token sees the text before its start, as a regex does", () => {
  expect(perSegment(lazyChain(a, token(/(?<!x)b/u)))("a xb b")).toEqual([
    { index: 0, text: "a xb b" },
  ]);
});

test("everyMatch reports each match of a pattern", () => {
  expect(everyMatch(/\ba\b/gu)("a b a")).toEqual([
    { index: 0, text: "a" },
    { index: 4, text: "a" },
  ]);
});

test("a long line of matches next to a token that never appears scans in linear time", () => {
  const chain = perSegment(anyOf(lazyChain(a, b), lazyChain(token(/\bz\b/u), b)));
  const { ratio, rounds } = slowdown(
    () => chain("a b ".repeat(50_000)),
    () => chain("a b\n".repeat(50_000)),
  );
  expect(ratio, rounds).toBeLessThan(3);
});

test("a long line of first tokens with no last token scans in linear time", () => {
  const chain = perSegment(greedyChain(a, b, c));
  const { ratio, rounds } = slowdown(
    () => chain("a b ".repeat(50_000)),
    () => chain("a b\n".repeat(50_000)),
  );
  expect(ratio, rounds).toBeLessThan(3);
});
