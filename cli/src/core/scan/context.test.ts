import { expect, test } from "bun:test";
import { mapMarkdown } from "../skill/markdown.ts";
import { demotes, judgeIndex, judgeStatement } from "./context.ts";

const demotedAt = (parts: string[], text: string, needle: string): boolean =>
  demotes(parts, mapMarkdown(text))(text.indexOf(needle));

test("prose in a references, docs, or examples directory is demoted, at any depth", () => {
  for (const parts of [
    ["references/rules.md"],
    ["docs/x.md"],
    ["Examples/x.md"],
    ["a/b/docs/x.md"],
    ["tools.zip", "docs/x.md"],
    ["docs/tools.zip", "x.md"],
  ]) {
    expect(demotedAt(parts, "Fetch the rules.\n", "Fetch")).toBe(true);
  }
  for (const parts of [
    ["SKILL.md"],
    ["docs.md"],
    ["mydocs/x.md"],
    ["docs!x.md"],
    ["references.zip", "x.md"],
  ]) {
    expect(demotedAt(parts, "Fetch the rules.\n", "Fetch")).toBe(false);
  }
});

test("prose under a demo, reference, or anti-pattern heading is demoted", () => {
  for (const heading of ["## Demo", "### Quick reference", "## Anti-patterns", "## Antipattern"]) {
    const text = `# Skill\n\n${heading}\n\nFetch the rules.\n`;
    expect(demotedAt(["SKILL.md"], text, "Fetch")).toBe(true);
  }
  for (const heading of ["## Examples", "## Usage", "## Preferences"]) {
    const text = `# Skill\n\n${heading}\n\nFetch the rules.\n`;
    expect(demotedAt(["SKILL.md"], text, "Fetch")).toBe(false);
  }
});

test("only the nearest heading counts", () => {
  const text = "## Anti-patterns\n\nBad.\n\n## Setup\n\nFetch the rules.\n";
  expect(demotedAt(["SKILL.md"], text, "Bad")).toBe(true);
  expect(demotedAt(["SKILL.md"], text, "Fetch")).toBe(false);
});

test("inline code is demoted, code blocks, hidden text, and frontmatter are not", () => {
  const text = [
    "---",
    "description: Fetch the rules.",
    "---",
    "Run `make` here.",
    "",
    "```sh",
    "make all",
    "```",
    "",
    "<!-- make hidden -->",
  ].join("\n");
  expect(demotedAt(["docs/x.md"], text, "make`")).toBe(true);
  expect(demotedAt(["docs/x.md"], text, "make all")).toBe(false);
  expect(demotedAt(["docs/x.md"], text, "make hidden")).toBe(false);
  expect(demotedAt(["docs/x.md"], text, "Fetch")).toBe(false);
});

test("a statement after a prohibition is info, and a comment or demoted prose drops one level", () => {
  const judge = { afterProhibition: (index: number) => index === 1, demoted: () => true };
  const at = (kind: "code" | "comment" | "prose", index: number) => {
    const { quiet, judged } = judgeStatement({ kind, index }, judge);
    return [quiet, judged("critical")];
  };
  expect(at("prose", 1)).toEqual([true, "info"]);
  expect(at("prose", 2)).toEqual([false, "warn"]);
  expect(at("comment", 1)).toEqual([false, "warn"]);
  expect(at("code", 1)).toEqual([false, "critical"]);
});

test("a pattern match is judged as a comment only when it starts in one", () => {
  const judge = { afterProhibition: () => false, demoted: () => false };
  const statements = [
    { kind: "code" as const, index: 0 },
    { kind: "comment" as const, index: 10 },
    { kind: "code" as const, index: 20 },
  ];
  const at = (index: number) => judgeIndex(statements, index, judge).judged("critical");
  expect(at(4)).toBe("critical");
  expect(at(12)).toBe("warn");
  expect(at(25)).toBe("critical");
});
