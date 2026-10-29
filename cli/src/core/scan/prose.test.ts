import { expect, test } from "bun:test";
import { mapMarkdown } from "../skill/markdown.ts";
import { proseSentences, reportPhrases, sentences } from "./prose.ts";

const noProseContext = { afterProhibition: () => false, demoted: () => false };

test("sentences split at end punctuation, blank lines and list items", () => {
  expect(sentences("One. Two!\n\nThree\n- Four", 10)).toEqual([
    { index: 10, text: "One." },
    { index: 15, text: "Two!" },
    { index: 21, text: "Three" },
    { index: 27, text: "- Four" },
  ]);
});

test("Markdown prose skips code blocks and reads each frontmatter field", () => {
  const text =
    "---\nname: a\ndescription: Moves\n  funds.\n---\nBody text.\n\n```\ncode here.\n```\n";
  expect(proseSentences(text, mapMarkdown(text)).map((s) => s.text)).toEqual([
    "Body text.",
    "name: a",
    "description: Moves\n  funds.",
  ]);
});

test("the strongest phrase is reported, and a prohibition makes it info", () => {
  const text = "Do this.\nNever do that.";
  const phrases = [
    { index: 0, sentence: "Do this.", severity: "warn" as const },
    { index: 15, sentence: "do that.", severity: "critical" as const },
  ];
  expect(reportPhrases(text, phrases, noProseContext)).toEqual({
    severity: "critical",
    line: 2,
    detail: "do that. (2 matches)",
  });
  expect(
    reportPhrases(text, phrases, { ...noProseContext, afterProhibition: (i) => i === 15 }),
  ).toEqual({ severity: "warn", line: 1, detail: "Do this. (2 matches)" });
});
