import { expect, test } from "bun:test";
import { MODE_FILE, type SkillFile } from "../skill/files.ts";
import { slowdown } from "../../test-timing.ts";
import { bundledPaths, bundledReference } from "./bundled-reference.ts";

const PLIST = "Editor.app/Contents/Info.plist";
const skill: SkillFile = { path: "SKILL.md", content: Buffer.from(""), mode: MODE_FILE };
const bundled = bundledPaths([skill, { ...skill, path: PLIST }]);

// Each link that `text` holds, as linkify reports a schemeless one.
const links = (text: string) =>
  Array.from(text.matchAll(/Editor\.app\/Contents\/Info\.plist/gu), (match) => ({
    schema: "",
    text: match[0],
    index: match.index,
  }));

const localLinks = (text: string): boolean[] => {
  const isLocal = bundledReference(skill, text, bundled);
  return links(text).map(isLocal);
};

test("a bundled path is local unless a download command comes before it on its line", () => {
  expect(localLinks(`Open ${PLIST}.\nRun curl ${PLIST}.\nThen ${PLIST}.`)).toEqual([
    true,
    false,
    true,
  ]);
  expect(localLinks(`Open ${PLIST}, then curl it.`)).toEqual([true]);
});

test("a long line of bundled paths after a download command is checked in linear time", () => {
  let run = 0;
  const check = (separator: string) => () =>
    localLinks(`curl ${run++} ${`${PLIST}${separator}`.repeat(20_000)}`);
  const { ratio, rounds } = slowdown(check(" "), check("\n"));
  expect(ratio, rounds).toBeLessThan(3);
});
