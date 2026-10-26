import { expect, test } from "bun:test";
import { findMentions, missingDeps } from "./deps.ts";
import type { SkillFile } from "./files.ts";

const md = (path: string, content: string): SkillFile => ({
  path,
  content: Buffer.from(content),
  mode: "100644",
});

const at = (name: string) => ({ name, path: `skills/${name}` });

const KNOWN = [
  "codebase-design",
  "grilling",
  "domain-modeling",
  "tdd",
  "code-review",
  "research",
].map(at);

const names = (files: SkillFile[], self = "self"): string[] =>
  findMentions(files, at(self), KNOWN).map((r) => r.name);

test("slash idiom", () => {
  expect(names([md("SKILL.md", "Use /tdd where possible, at pre-agreed seams.")])).toEqual(["tdd"]);
});

test("backtick idiom needs the word skill nearby", () => {
  expect(names([md("SKILL.md", "see the `code-review` skill")])).toEqual(["code-review"]);
  expect(names([md("SKILL.md", "the `code-review` module handles this")])).toEqual([]);
});

test("backticked slash reference, no nearby skill word", () => {
  expect(names([md("SKILL.md", "Resolved by a `/research` **subagent**.")])).toEqual(["research"]);
});

test("only names known in the repo resolve", () => {
  const text = "Write to /tmp, see /issues and /docs, run /compact, check /users/me.";
  expect(names([md("SKILL.md", text)])).toEqual([]);
});

test("path segments and closing tags are not references", () => {
  const files = [
    md("SKILL.md", "read docs/agents/tdd for details"),
    md("a.md", "</grilling>"),
    md("b.md", "notes.md/tdd"),
  ];
  expect(names(files)).toEqual([]);
});

test("self-references are skipped", () => {
  expect(names([md("SKILL.md", "re-run /tdd to restart")], "tdd")).toEqual([]);
});

test("non-markdown files are ignored", () => {
  const files = [md("agents/openai.yaml", "skills: [/tdd, /grilling, /research]")];
  expect(names(files)).toEqual([]);
});

test("deduped by name, first mention cited, sorted", () => {
  const files = [
    md("SKILL.md", "line one\nrun the `/grilling` skill\nand /tdd\nlater /grilling again"),
    md("HTML-REPORT.md", "vocabulary from the `/codebase-design` skill"),
  ];
  const refs = findMentions(files, at("self"), KNOWN);
  expect(refs.map((r) => r.name)).toEqual(["codebase-design", "grilling", "tdd"]);
  expect(refs.find((r) => r.name === "grilling")).toEqual({
    name: "grilling",
    file: "SKILL.md",
    line: 2,
  });
  expect(refs.find((r) => r.name === "codebase-design")!.file).toBe("HTML-REPORT.md");
});

test("references inside a fenced block are examples, not dependencies", () => {
  const text = ["Usage:", "", "```", "/tdd", "```", "", "then run the `grilling` skill"].join("\n");
  const refs = findMentions([md("SKILL.md", text)], at("self"), KNOWN);
  expect(refs.map((r) => r.name)).toEqual(["grilling"]);
  expect(refs[0]!.line).toBe(7);
});

test("trailing punctuation does not break the match", () => {
  expect(names([md("SKILL.md", "hand off to /tdd. Then stop.")])).toEqual(["tdd"]);
});

test("Markdown link idiom: a relative link to another skill's SKILL.md or directory", () => {
  const text =
    "intro\nRead [the workflow](../tdd/SKILL.md) first.\nSee [grilling](<../grilling/>).";
  const refs = findMentions([md("SKILL.md", text)], at("self"), KNOWN);
  expect(refs).toEqual([
    { name: "grilling", file: "SKILL.md", line: 3 },
    { name: "tdd", file: "SKILL.md", line: 2 },
  ]);
});

test("Markdown link idiom resolves the path, not the directory name", () => {
  const known = [{ name: "full-send", path: "skills/send-it" }];
  const files = [md("references/steps.md", "Follow [it](../../send-it/SKILL.md#proof).")];
  expect(findMentions(files, at("full-stop"), known).map((r) => r.name)).toEqual(["full-send"]);
  expect(names([md("SKILL.md", "[x](../full-send/SKILL.md)")])).toEqual([]);
});

test("Markdown link idiom accepts a title, a query, and a root-level skill", () => {
  const known = [{ name: "root", path: "" }, ...KNOWN];
  const files = [md("SKILL.md", '[t](../tdd/SKILL.md?v=1 "TDD")\n[r](../../SKILL.md)')];
  expect(findMentions(files, at("self"), known).map((r) => r.name)).toEqual(["root", "tdd"]);
});

test("the earliest mention in a file is cited, whatever its idiom", () => {
  const text = "line\n[the loop](../tdd/SKILL.md)\nthen /tdd and the `tdd` skill";
  expect(findMentions([md("SKILL.md", text)], at("self"), KNOWN)[0]!.line).toBe(2);
});

test("external, fenced, non-skill and self links are not mentions", () => {
  const text = [
    "[web](https://example.com/skills/tdd/SKILL.md)",
    "[ref](../tdd/references/notes.md)",
    "[absolute](/skills/tdd/SKILL.md)",
    "[me](./SKILL.md) and [me too](../self/)",
    "```",
    "[fenced](../grilling/SKILL.md)",
    "```",
  ].join("\n");
  expect(names([md("SKILL.md", text)])).toEqual([]);
});

test("Markdown reference links cite the line that uses them, not the definition", () => {
  const text = [
    "Read [the loop][tdd-ref] first.",
    "Then [Grilling][] and [Research].",
    "",
    "[TDD-Ref]: ../tdd/SKILL.md",
    "[grilling]: <../grilling/> 'Grilling'",
    "[research]: ../research/SKILL.md",
  ].join("\n");
  expect(findMentions([md("SKILL.md", text)], at("self"), KNOWN)).toEqual([
    { name: "grilling", file: "SKILL.md", line: 2 },
    { name: "research", file: "SKILL.md", line: 2 },
    { name: "tdd", file: "SKILL.md", line: 1 },
  ]);
});

test("a Markdown reference definition alone, or a use without one, is not a mention", () => {
  const text = "[tdd]: ../tdd/SKILL.md\n\nSee [grilling][nowhere] and [research].";
  expect(names([md("SKILL.md", text)])).toEqual([]);
});

test("an angle-bracket Markdown link destination may contain spaces", () => {
  const known = [{ name: "full-send", path: "skills/full send" }];
  const files = [md("SKILL.md", "Then [full-send](<../full send/SKILL.md>).")];
  expect(findMentions(files, at("full-stop"), known).map((r) => r.name)).toEqual(["full-send"]);
});

test("slash and backtick idioms inside a Markdown link destination are not mentions", () => {
  const text = [
    "[read](/tdd) and [see][g]",
    "[x](<`domain-modeling` skill.md>)",
    "",
    "[g]: /grilling",
    "[run /research](../code-review/SKILL.md)",
  ].join("\n");
  expect(findMentions([md("SKILL.md", text)], at("self"), KNOWN)).toEqual([
    { name: "code-review", file: "SKILL.md", line: 5 },
    { name: "research", file: "SKILL.md", line: 5 },
  ]);
});

test("a Markdown link to an ambiguous skill carries the linked path, even after a name mention", () => {
  const known = [
    { name: "twin", path: "a/twin", ambiguous: true },
    { name: "twin", path: "b/twin", ambiguous: true },
  ];
  expect(findMentions([md("SKILL.md", "Use /twin.")], at("self"), known)).toEqual([
    { name: "twin", file: "SKILL.md", line: 1 },
  ]);
  const files = [
    md("SKILL.md", "Use /twin."),
    md("refs/x.md", "Or [it](../../../b/twin/SKILL.md)."),
  ];
  expect(findMentions(files, at("self"), known)).toEqual([
    { name: "twin", path: "b/twin", file: "SKILL.md", line: 1 },
  ]);
  const batch = [
    { ...at("one"), files: [md("SKILL.md", "Use /twin.")] },
    { ...at("two"), files: [md("SKILL.md", "Use [it](../../b/twin/SKILL.md).")] },
  ];
  expect(missingDeps(batch, known, () => false)).toEqual([
    { name: "twin", path: "b/twin", file: "SKILL.md", line: 1, from: "one" },
  ]);
});

test("missingDeps drops batch members, skills already here and repeats; first mention wins", () => {
  const batch = [
    { ...at("a"), files: [md("SKILL.md", "run /tdd then /grilling and /research")] },
    { ...at("tdd"), files: [md("SKILL.md", "line\nsee the `grilling` skill")] },
  ];
  const missing = missingDeps(batch, KNOWN, (n) => n === "research");
  expect(missing).toEqual([{ name: "grilling", file: "SKILL.md", line: 1, from: "a" }]);
});
