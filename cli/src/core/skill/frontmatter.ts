import { parse } from "yaml";

const OPEN = /^\uFEFF?---[ \t]*\r?\n/u;
const CLOSE = /^---[ \t]*\r?$/u;

// `end` is the offset just past the closing `---` line, before its line break.
export interface FrontmatterBlock {
  yaml: string;
  end: number;
}

// The first line is `---`, after an optional byte order mark. The block ends at the next line that
// is `---` and nothing else, so it may be empty.
export const frontmatterBlock = (text: string): FrontmatterBlock | undefined => {
  const open = OPEN.exec(text);
  if (!open) return undefined;
  const start = open[0].length;
  for (let at = start; at <= text.length;) {
    const newline = text.indexOf("\n", at);
    const end = newline === -1 ? text.length : newline;
    if (CLOSE.test(text.slice(at, end))) return { yaml: text.slice(start, at), end };
    if (newline === -1) return undefined;
    at = newline + 1;
  }
  return undefined;
};

export const parseFrontmatter = (text: string): Record<string, unknown> => {
  const block = frontmatterBlock(text);
  if (!block) return {};
  const doc: unknown = parse(block.yaml);
  if (doc === null) return {};
  if (typeof doc !== "object" || Array.isArray(doc)) {
    throw new SyntaxError("frontmatter is not a mapping");
  }
  return Object.fromEntries(
    Object.entries(doc).map(([key, value]) => [
      key.toLowerCase(),
      typeof value === "string" ? value.trim() : value,
    ]),
  );
};

export const asText = (value: unknown): string =>
  value === undefined || value === null
    ? ""
    : typeof value === "string"
      ? value
      : (JSON.stringify(value) ?? "");
