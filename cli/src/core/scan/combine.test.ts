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

test("a relation limits which partners count", () => {
  const anchors = [at(1, "a.sh")];
  const partners = [at(2, "b.sh"), at(9, "a.sh")];
  expect(
    names(
      combine(anchors, partners, { related: (anchor, partner) => anchor.name === partner.name }),
    ),
  ).toEqual([["a.sh", "a.sh"]]);
});

test("an anchor with no partner is left out", () => {
  expect(names(combine([at(1)], []))).toEqual([]);
});
