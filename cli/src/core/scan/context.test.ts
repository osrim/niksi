import { expect, test } from "bun:test";
import { mapMarkdown } from "../skill/markdown.ts";
import { demotes } from "./context.ts";

const demotedAt = (path: string, text: string, needle: string): boolean =>
  demotes(path, mapMarkdown(text))(text.indexOf(needle));

test("prose in a references, docs, or examples directory is demoted, at any depth", () => {
  for (const path of [
    "references/rules.md",
    "docs/x.md",
    "Examples/x.md",
    "a/b/docs/x.md",
    "tools.zip!docs/x.md",
  ]) {
    expect(demotedAt(path, "Fetch the rules.\n", "Fetch")).toBe(true);
  }
  for (const path of ["SKILL.md", "docs.md", "mydocs/x.md", "references.zip!x.md"]) {
    expect(demotedAt(path, "Fetch the rules.\n", "Fetch")).toBe(false);
  }
});

test("prose under a demo, reference, or anti-pattern heading is demoted", () => {
  for (const heading of ["## Demo", "### Quick reference", "## Anti-patterns", "## Antipattern"]) {
    const text = `# Skill\n\n${heading}\n\nFetch the rules.\n`;
    expect(demotedAt("SKILL.md", text, "Fetch")).toBe(true);
  }
  for (const heading of ["## Examples", "## Usage", "## Preferences"]) {
    const text = `# Skill\n\n${heading}\n\nFetch the rules.\n`;
    expect(demotedAt("SKILL.md", text, "Fetch")).toBe(false);
  }
});

test("only the nearest heading counts", () => {
  const text = "## Anti-patterns\n\nBad.\n\n## Setup\n\nFetch the rules.\n";
  expect(demotedAt("SKILL.md", text, "Bad")).toBe(true);
  expect(demotedAt("SKILL.md", text, "Fetch")).toBe(false);
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
  expect(demotedAt("docs/x.md", text, "make`")).toBe(true);
  expect(demotedAt("docs/x.md", text, "make all")).toBe(false);
  expect(demotedAt("docs/x.md", text, "make hidden")).toBe(false);
  expect(demotedAt("docs/x.md", text, "Fetch")).toBe(false);
});
