import { expect, test } from "bun:test";
import { mapMarkdown } from "../skill/markdown.ts";
import { hiddenHtml } from "./hidden-html.ts";
import type { Finding } from "./index.ts";

const judge = (text: string, scan: (body: string) => Finding[] = () => []) =>
  hiddenHtml(text, mapMarkdown(text).hidden, scan);

const match = (severity: Finding["severity"]): Finding[] => [
  { rule: "prompt-injection", help: "", severity, confidence: "medium", detail: "" },
];

test("a warn match inside hidden text is critical and names its rule", () => {
  expect(judge("Intro.\n\n<!-- quiet words -->\n", () => match("warn"))).toEqual({
    severity: "critical",
    line: 3,
    detail: 'HTML comment: "quiet words" (prompt-injection)',
  });
});

test("an info match counts for nothing, and the strongest of several texts is reported", () => {
  const text = '<!-- short -->\n\n<img alt="a picture with a fairly long description here">\n';
  expect(judge(text, () => match("info"))).toEqual({
    severity: "info",
    line: 3,
    detail: 'alt or title text: "a picture with a fairly long description here"',
  });
  expect(judge(`${text}\n<!-- see https://mirror.niksi.dev -->\n`)?.detail).toBe(
    'HTML comment: "see https://mirror.niksi.dev" (2 hidden texts)',
  );
});
