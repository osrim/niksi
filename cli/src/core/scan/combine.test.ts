import { expect, test } from "bun:test";
import { combine } from "./combine.ts";

const at = (line: number, name = `L${line}`) => ({ line, name });

const names = (
  pairs: ReturnType<typeof combine<{ line: number; name: string }, { line: number; name: string }>>,
) => pairs.map(({ anchor, partner }) => [anchor.name, partner.name]);

test("without a distance, any partner in the same file pairs with the anchor", () => {
  expect(names(combine([at(2)], [at(90)]))).toEqual([["L2", "L90"]]);
});

test("each anchor pairs with its nearest partner, before or after it", () => {
  expect(names(combine([at(10), at(40)], [at(3), at(12), at(37)]))).toEqual([
    ["L10", "L12"],
    ["L40", "L37"],
  ]);
});

test("within N lines drops partners further away", () => {
  expect(names(combine([at(10)], [at(14), at(30)], { within: 3 }))).toEqual([]);
  expect(names(combine([at(10)], [at(13), at(30)], { within: 3 }))).toEqual([["L10", "L13"]]);
  expect(names(combine([at(10)], [at(10)], { within: 0 }))).toEqual([["L10", "L10"]]);
});

test("on equal distance the partner earlier in the input wins", () => {
  expect(names(combine([at(10)], [at(12, "after"), at(8, "before")]))).toEqual([["L10", "after"]]);
  expect(names(combine([at(10)], [at(8, "before"), at(12, "after")]))).toEqual([["L10", "before"]]);
  expect(names(combine([at(10)], [at(12, "first"), at(30), at(12, "second")]))).toEqual([
    ["L10", "first"],
  ]);
});

test("a key limits partners to those with the anchor's key", () => {
  const anchors = [at(1, "a.sh")];
  const partners = [at(2, "b.sh"), at(9, "a.sh")];
  expect(names(combine(anchors, partners, { key: (item) => item.name }))).toEqual([
    ["a.sh", "a.sh"],
  ]);
});

test("before limits partners to the anchor's line and earlier", () => {
  expect(names(combine([at(10)], [at(11), at(5)], { before: true }))).toEqual([["L10", "L5"]]);
  expect(names(combine([at(10)], [at(10), at(5)], { before: true }))).toEqual([["L10", "L10"]]);
  expect(names(combine([at(10)], [at(11)], { before: true }))).toEqual([]);
});

test("an anchor with no partner is left out", () => {
  expect(names(combine([at(1)], []))).toEqual([]);
});

test("pairing time grows linearly with the matches", () => {
  const count = 40_000;
  const anchors = Array.from({ length: count }, (_, i) => at(2 * i + 2));
  const partners = Array.from({ length: count }, (_, i) => at(2 * i + 1));
  const start = performance.now();
  expect(combine(anchors, partners, { within: 20 })).toHaveLength(count);
  expect(combine(anchors, partners, { key: (item) => item.name })).toEqual([]);
  expect(combine(anchors, partners.toReversed(), { within: 20, before: true })).toHaveLength(count);
  expect(performance.now() - start).toBeLessThan(1000);
});
