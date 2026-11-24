import { parse } from "yaml";

const OPEN = /^\uFEFF?---\s*\n/u;
const CLOSE = "---";

// `end` is the offset just past the closing `---`.
export interface FrontmatterBlock {
  yaml: string;
  end: number;
}

// The first line is `---`, after an optional byte order mark. The block ends at the next `---`,
// wherever it stands, as Claude Code reads it: `--- # end`, `---x`, and `a: b---c` all end it, and
// the rest of that line is body. So the scan never misses a field that Claude Code applies.
export const frontmatterBlock = (text: string): FrontmatterBlock | undefined => {
  const open = OPEN.exec(text);
  if (!open) return undefined;
  const start = open[0].length;
  const close = text.indexOf(CLOSE, start);
  if (close === -1) return undefined;
  return { yaml: text.slice(start, close), end: close + CLOSE.length };
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
