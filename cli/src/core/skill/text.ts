import MarkdownIt from "markdown-it";

export const lineAt = (text: string, index: number): number =>
  text.slice(0, index).split("\n").length;

export const lineStarts = (text: string): number[] => {
  const starts = [0];
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
  return starts;
};

// Zero-based line that holds `index`.
export const lineOf = (starts: readonly number[], index: number): number => {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (starts[mid]! <= index) lo = mid;
    else hi = mid - 1;
  }
  return lo;
};

const markdown = new MarkdownIt();

export interface Fence {
  infoString: string;
  content: string;
  startLine: number;
  endLineExclusive: number;
}

export const codeFences = (text: string): Fence[] =>
  markdown.parse(text, {}).flatMap((token) => {
    const [start, end] = token.map ?? [];
    return token.type === "fence" && start !== undefined && end !== undefined
      ? [
          {
            infoString: token.info,
            content: token.content,
            startLine: start,
            endLineExclusive: end,
          },
        ]
      : [];
  });

const fencedLines = (text: string): Set<number> => {
  const lines = new Set<number>();
  for (const fence of codeFences(text)) {
    for (let line = fence.startLine; line < fence.endLineExclusive; line += 1) lines.add(line);
  }
  return lines;
};

export const stripFencedCode = (text: string): string => {
  const fenced = fencedLines(text);
  return text
    .split("\n")
    .map((line, index) => (fenced.has(index) ? "" : line))
    .join("\n");
};
