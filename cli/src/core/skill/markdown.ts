import MarkdownIt from "markdown-it";
import { lineOf, lineStarts } from "./text.ts";

// text.ts parses without HTML. Here raw HTML must end a fence, as it does when rendered.
const markdown = new MarkdownIt({ html: true });

type Token = ReturnType<typeof markdown.parse>[number];

export type Context = "prose" | "frontmatter" | "fence" | "indented" | "inline" | "hidden";

const CONTEXTS: readonly Context[] = [
  "prose",
  "frontmatter",
  "fence",
  "indented",
  "inline",
  "hidden",
];

const HIDDEN = CONTEXTS.indexOf("hidden");
const FENCE = CONTEXTS.indexOf("fence");
const INDENTED = CONTEXTS.indexOf("indented");

export type HiddenKind = "comment" | "element" | "attribute" | "definition";

export interface Span {
  context: Context;
  start: number;
  end: number;
  line: number;
}

export interface Hidden {
  kind: HiddenKind;
  start: number;
  end: number;
  line: number;
}

export interface CodeBlock {
  context: "fence" | "indented";
  info: string;
  // First body line, counted from 1.
  line: number;
  lines: number;
}

export interface MarkdownMap {
  contextAt: (index: number) => Context;
  // A fence or indented code block.
  isCode: (index: number) => boolean;
  headingAt: (index: number) => string | undefined;
  spans: (context: Context) => Span[];
  hidden: Hidden[];
  codeBlocks: CodeBlock[];
}

interface Tagger {
  text: string;
  tags: Uint8Array;
  starts: number[];
  hidden: Hidden[];
}

const offsetOf = (t: Tagger, line: number): number => t.starts[line] ?? t.text.length;

const mark = (t: Tagger, start: number, end: number, context: Context): void => {
  const value = CONTEXTS.indexOf(context);
  for (let i = start; i < end; i++) if (t.tags[i] !== HIDDEN) t.tags[i] = value;
};

const hide = (t: Tagger, kind: HiddenKind, start: number, end: number): void => {
  if (start >= end || t.tags[start] === HIDDEN) return;
  mark(t, start, end, "hidden");
  t.hidden.push({ kind, start, end, line: lineOf(t.starts, start) + 1 });
};

const codeSpan = (t: Tagger, i: number, end: number): number => {
  let n = 0;
  while (t.text[i + n] === "`") n++;
  const ticks = /`+/gu;
  ticks.lastIndex = i + n;
  for (let run = ticks.exec(t.text); run && run.index < end; run = ticks.exec(t.text)) {
    if (run[0].length !== n) continue;
    mark(t, i + n, run.index, "inline");
    return run.index + n;
  }
  return i + n;
};

const comment = (t: Tagger, i: number, end: number): number => {
  const close = t.text.indexOf("-->", i + 4);
  const closed = close !== -1 && close < end;
  hide(t, "comment", i + 4, closed ? close : end);
  return closed ? close + 3 : end;
};

const OPEN_TAG =
  /<([A-Za-z][\w-]*)((?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/duy;
const ATTRIBUTE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/dgu;
const TEXT_ATTRIBUTES = new Set(["alt", "title"]);
const HIDING_STYLE =
  /display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?![.\d]*[1-9])|font-size\s*:\s*0(?![.\d]*[1-9])/iu;
const VOID_ELEMENTS = new Set([
  "area",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);

interface Attribute {
  name: string;
  value: string;
  start: number;
  end: number;
}

const attributes = (tag: RegExpExecArray): Attribute[] => {
  const offset = tag.indices![2]![0];
  return [...tag[2]!.matchAll(ATTRIBUTE)].map((attribute) => {
    const group = [2, 3, 4].find((g) => attribute[g] !== undefined);
    const [start, end] = group ? attribute.indices![group]! : [0, 0];
    return {
      name: attribute[1]!.toLowerCase(),
      value: group ? attribute[group]! : "",
      start: offset + start,
      end: offset + end,
    };
  });
};

const hides = ({ name, value }: Attribute): boolean =>
  name === "hidden" || (name === "style" && HIDING_STYLE.test(value));

// A hidden element hides everything up to its matching close tag, across blocks.
const hiddenElement = (t: Tagger, name: string, after: number): number => {
  const tags = new RegExp(String.raw`<(/?)${name}(?=[\s/>])[^>]*?(/?)>`, "giu");
  tags.lastIndex = after;
  let depth = 1;
  for (let tag = tags.exec(t.text); tag; tag = tags.exec(t.text)) {
    if (tag[1]) depth--;
    else if (!tag[2]) depth++;
    if (depth > 0) continue;
    hide(t, "element", after, tag.index);
    return tag.index + tag[0].length;
  }
  hide(t, "element", after, t.text.length);
  return t.text.length;
};

const htmlAt = (t: Tagger, i: number, end: number): number | undefined => {
  if (t.text.startsWith("<!--", i)) return comment(t, i, end);
  OPEN_TAG.lastIndex = i;
  const tag = OPEN_TAG.exec(t.text);
  if (!tag) return undefined;
  const name = tag[1]!.toLowerCase();
  const found = attributes(tag);
  for (const attribute of found) {
    if (TEXT_ATTRIBUTES.has(attribute.name)) hide(t, "attribute", attribute.start, attribute.end);
  }
  const after = i + tag[0].length;
  if (tag[3] || VOID_ELEMENTS.has(name) || !found.some(hides)) return after;
  return hiddenElement(t, name, after);
};

const LINK =
  /(!?)\[([^[\]]*)\]\(\s*(?:<[^>\n]*>|[^\s()]*)(?:\s+(?:"([^"]*)"|'([^']*)'|\(([^)]*)\)))?\s*\)/duy;
const IMAGE_REFERENCE = /!\[([^[\]]*)\]\[[^[\]]*\]/duy;

const hideGroups = (
  t: Tagger,
  match: RegExpExecArray,
  kind: HiddenKind,
  groups: number[],
): void => {
  for (const group of groups) {
    const [start, end] = match.indices![group] ?? [0, 0];
    hide(t, kind, start, end);
  }
};

// Link text is still scanned; an image's alt text and every title are hidden.
const imageReference = (t: Tagger, i: number, end: number): number | undefined => {
  IMAGE_REFERENCE.lastIndex = i;
  const image = IMAGE_REFERENCE.exec(t.text);
  if (!image || i + image[0].length > end) return undefined;
  hideGroups(t, image, "attribute", [1]);
  return i + image[0].length;
};

const linkAt = (t: Tagger, i: number, end: number): number | undefined => {
  LINK.lastIndex = i;
  const link = LINK.exec(t.text);
  if (!link || link.index + link[0].length > end) return imageReference(t, i, end);
  const image = link[1] === "!";
  hideGroups(t, link, "attribute", image ? [2, 3, 4, 5] : [3, 4, 5]);
  return image ? i + link[0].length : i + 1;
};

const inlineStep = (t: Tagger, i: number, end: number): number | undefined => {
  const ch = t.text[i];
  if (ch === "\\") return i + 2;
  if (ch === "`") return codeSpan(t, i, end);
  if (ch === "[" || ch === "!") return linkAt(t, i, end);
  return undefined;
};

const step = (t: Tagger, i: number, end: number, inline: boolean): number => {
  if (t.tags[i] === HIDDEN) return i + 1;
  if (t.text[i] === "<") return htmlAt(t, i, end) ?? i + 1;
  return (inline ? inlineStep(t, i, end) : undefined) ?? i + 1;
};

// An HTML block is raw HTML: no code spans, escapes, or Markdown links.
const scanRange = (t: Tagger, start: number, end: number, inline: boolean): void => {
  for (let i = start; i < end;) i = step(t, i, end, inline);
};

const QUOTED = String.raw`^(?: {0,3}> ?)*`;
const TITLE = String.raw`(?:"([^"]*)"|'([^']*)'|\(([^)]*)\))`;
const DEFINITION = new RegExp(
  String.raw`${QUOTED} {0,3}\[(?:[^\]\\]|\\.)+\]:[ \t]*(?:<[^>\n]*>|\S+)(?:[ \t]+${TITLE})?[ \t\r]*$`,
  "du",
);
const TITLE_LINE = new RegExp(String.raw`${QUOTED}[ \t]*${TITLE}[ \t\r]*$`, "du");

const hideTitle = (t: Tagger, line: number, pattern: RegExp): RegExpExecArray | null => {
  const start = offsetOf(t, line);
  if (t.tags[start] !== CONTEXTS.indexOf("prose")) return null;
  const match = pattern.exec(t.text.slice(start, offsetOf(t, line + 1)).replace(/\n$/u, ""));
  for (const group of match ? [1, 2, 3] : []) {
    const [from, to] = match!.indices![group] ?? [0, 0];
    hide(t, "definition", start + from, start + to);
  }
  return match;
};

// markdown-it consumes reference definitions without a token, so their lines stay unclaimed.
// A title may sit alone on the next line.
const definition = (t: Tagger, line: number, claimed: Set<number>): void => {
  const match = hideTitle(t, line, DEFINITION);
  if (match && [1, 2, 3].every((g) => match[g] === undefined) && !claimed.has(line + 1)) {
    hideTitle(t, line + 1, TITLE_LINE);
  }
};

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---[^\n]*/u;

const markFrontmatter = (t: Tagger): number => {
  const match = FRONTMATTER.exec(t.text);
  if (!match) return 0;
  mark(t, 0, match[0].length, "frontmatter");
  return lineOf(t.starts, match[0].length) + 1;
};

const codeBlock = (t: Tagger, token: Token, [a, b]: [number, number]): CodeBlock | undefined => {
  const context = token.type === "fence" ? "fence" : "indented";
  const hidden = t.tags[offsetOf(t, a)] === HIDDEN;
  mark(t, offsetOf(t, a), offsetOf(t, b), context);
  if (hidden) return undefined;
  const line = context === "fence" ? a + 2 : a + 1;
  return { context, info: token.info, line, lines: token.content.split("\n").length - 1 };
};

interface Heading {
  line: number;
  text: string;
}

const LEAVES = new Set(["fence", "code_block", "html_block", "inline"]);

const tagLeaf = (t: Tagger, token: Token, [a, b]: [number, number]): CodeBlock | undefined => {
  if (token.type === "fence" || token.type === "code_block") return codeBlock(t, token, [a, b]);
  scanRange(t, offsetOf(t, a), offsetOf(t, b), token.type === "inline");
  return undefined;
};

const walk = (t: Tagger, tokens: Token[], claimed: Set<number>) => {
  const headings: Heading[] = [];
  const codeBlocks: CodeBlock[] = [];
  for (const [i, token] of tokens.entries()) {
    if (!token.map) continue;
    const [a, b] = token.map;
    if (token.type === "heading_open" && t.tags[offsetOf(t, a)] !== HIDDEN) {
      headings.push({ line: a, text: tokens[i + 1]!.content });
    }
    if (!LEAVES.has(token.type)) continue;
    for (let line = a; line < b; line++) claimed.add(line);
    const block = tagLeaf(t, token, [a, b]);
    if (block) codeBlocks.push(block);
  }
  return { headings, codeBlocks };
};

const runs = (t: Tagger): Span[] => {
  const spans: Span[] = [];
  for (let start = 0, i = 1; i <= t.tags.length; i++) {
    if (i < t.tags.length && t.tags[i] === t.tags[start]) continue;
    const context = CONTEXTS[t.tags[start]!]!;
    spans.push({ context, start, end: i, line: lineOf(t.starts, start) + 1 });
    start = i;
  }
  return spans;
};

export const mapMarkdown = (text: string): MarkdownMap => {
  const t: Tagger = {
    text,
    tags: new Uint8Array(text.length),
    starts: lineStarts(text),
    hidden: [],
  };
  const skipped = markFrontmatter(t);
  const body = "\n".repeat(skipped) + text.slice(offsetOf(t, skipped));
  const claimed = new Set<number>();
  const { headings, codeBlocks } = walk(t, markdown.parse(body, {}), claimed);
  for (let line = skipped; line < t.starts.length; line++) {
    if (!claimed.has(line)) definition(t, line, claimed);
  }
  let spans: Span[] | undefined;
  return {
    contextAt: (index) => CONTEXTS[t.tags[index] ?? 0]!,
    isCode: (index) => [FENCE, INDENTED].includes(t.tags[index] ?? 0),
    headingAt: (index) => {
      const line = lineOf(t.starts, index);
      return headings.findLast((heading) => heading.line <= line)?.text;
    },
    spans: (context) => (spans ??= runs(t)).filter((span) => span.context === context),
    hidden: t.hidden.toSorted((a, b) => a.start - b.start),
    codeBlocks,
  };
};
