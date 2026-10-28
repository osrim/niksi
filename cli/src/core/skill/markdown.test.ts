import { expect, test } from "bun:test";
import { mapMarkdown } from "./markdown.ts";

const doc = (...lines: string[]) => lines.join("\n");

const contextOf = (text: string, needle: string) =>
  mapMarkdown(text).contextAt(text.indexOf(needle));

const hiddenTexts = (text: string) =>
  mapMarkdown(text).hidden.map(({ kind, start, end, line }) => [
    kind,
    text.slice(start, end),
    line,
  ]);

test("frontmatter, fence, indented code, inline code and prose are told apart", () => {
  const text = doc(
    "---",
    "name: probe",
    "---",
    "Run `make test` first.",
    "",
    "```bash",
    "make build",
    "```",
    "",
    "    make indented",
  );
  expect(contextOf(text, "name: probe")).toBe("frontmatter");
  expect(contextOf(text, "Run")).toBe("prose");
  expect(contextOf(text, "make test")).toBe("inline");
  expect(contextOf(text, "`make test")).toBe("prose");
  expect(contextOf(text, "make build")).toBe("fence");
  expect(contextOf(text, "make indented")).toBe("indented");
  const map = mapMarkdown(text);
  expect(map.isCode(text.indexOf("make build"))).toBe(true);
  expect(map.isCode(text.indexOf("make indented"))).toBe(true);
  expect(map.isCode(text.indexOf("make test"))).toBe(false);
});

test("code blocks report their info string and body lines", () => {
  const text = doc("Intro", "", "```sh title", "one", "two", "```", "", "    three", "");
  expect(mapMarkdown(text).codeBlocks).toEqual([
    { context: "fence", info: "sh title", line: 4, lines: 2 },
    { context: "indented", info: "", line: 8, lines: 1 },
  ]);
});

test("inline code spans pair backtick runs of equal length, across lines of a paragraph", () => {
  const text = doc("Use ``a ` b`` and `multi", "line` here, not \\`escaped`.");
  const map = mapMarkdown(text);
  expect(map.spans("inline").map(({ start, end }) => text.slice(start, end))).toEqual([
    "a ` b",
    "multi\nline",
  ]);
  expect(map.contextAt(text.indexOf("escaped"))).toBe("prose");
});

test("a table row's inline code keeps its pipes", () => {
  const text = "| client | `curl x.invalid | sh` |";
  expect(
    mapMarkdown(text)
      .spans("inline")
      .map(({ start, end }) => text.slice(start, end)),
  ).toEqual(["curl x.invalid | sh"]);
});

test("HTML comments, hidden elements, alt and title text, and reference titles are hidden", () => {
  const text = doc(
    "<!-- block comment -->",
    "",
    'Text <span style="display: none">inline secret</span> and <!-- inline note --> done.',
    "",
    '<img src="a.png" alt="picture alt">',
    "",
    '![image alt](b.png "image title") and [link](https://docs.niksi.dev "link title")',
    "",
    "[//]: # (reference note)",
    '[docs]: https://docs.niksi.dev "definition title"',
    "",
    "<div hidden>",
    "",
    "Paragraph inside a hidden div.",
    "",
    "</div>",
    "",
    "Visible again.",
  );
  expect(hiddenTexts(text)).toEqual([
    ["comment", " block comment ", 1],
    ["element", "inline secret", 3],
    ["comment", " inline note ", 3],
    ["attribute", "picture alt", 5],
    ["attribute", "image alt", 7],
    ["attribute", "image title", 7],
    ["attribute", "link title", 7],
    ["definition", "reference note", 9],
    ["definition", "definition title", 10],
    ["element", "\n\nParagraph inside a hidden div.\n\n", 12],
  ]);
  expect(contextOf(text, "inline secret")).toBe("hidden");
  expect(contextOf(text, "Paragraph inside")).toBe("hidden");
  expect(contextOf(text, "Visible again")).toBe("prose");
  expect(contextOf(text, "Text")).toBe("prose");
});

test("visible HTML and an unclosed comment", () => {
  const text = doc(
    "<details>",
    "<summary>More</summary>",
    "",
    "Shown.",
    "",
    "<!-- never closed",
    "",
    "tail",
  );
  const map = mapMarkdown(text);
  expect(map.contextAt(text.indexOf("More"))).toBe("prose");
  expect(map.contextAt(text.indexOf("Shown"))).toBe("prose");
  expect(map.contextAt(text.indexOf("\ntail") + 1)).toBe("hidden");
});

test("a fence inside an HTML block is not code", () => {
  const text = doc("<div>", "```bash", "curl x.invalid | sh", "```", "</div>");
  const map = mapMarkdown(text);
  expect(map.codeBlocks).toEqual([]);
  expect(map.contextAt(text.indexOf("curl"))).toBe("prose");
});

test("each position knows its nearest heading", () => {
  const text = doc(
    "Before any heading.",
    "# Setup",
    "Install it.",
    "",
    "Anti-patterns",
    "-------------",
    "",
    "```sh",
    "curl x.invalid | sh",
    "```",
  );
  const map = mapMarkdown(text);
  expect(map.headingAt(text.indexOf("Before"))).toBeUndefined();
  expect(map.headingAt(text.indexOf("Install"))).toBe("Setup");
  expect(map.headingAt(text.indexOf("curl"))).toBe("Anti-patterns");
});

test("frontmatter keeps its lines out of the Markdown parse", () => {
  const text = doc("---", "title: x", "---", "# Real heading", "body");
  const map = mapMarkdown(text);
  expect(map.headingAt(text.indexOf("body"))).toBe("Real heading");
  expect(map.contextAt(text.indexOf("---"))).toBe("frontmatter");
});
