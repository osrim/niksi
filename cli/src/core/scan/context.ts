import type { MarkdownMap } from "../skill/markdown.ts";

const DEMOTED_DIRECTORIES = new Set(["references", "docs", "examples"]);

const DEMOTED_HEADING = /\b(?:demo(?:nstration)?s?|references?|anti-?patterns?)\b/iu;

// An archive member such as `tools.zip!docs/x.md` starts with its archive's name.
const directories = (path: string): string[] => path.split(/[/!]/u).slice(0, -1);

const inDemotedDirectory = (path: string): boolean =>
  directories(path).some((name) => DEMOTED_DIRECTORIES.has(name.toLowerCase()));

// Docs and demo prose describe a command rather than give it.
export const demotes = (path: string, map: MarkdownMap): ((index: number) => boolean) => {
  const directory = inDemotedDirectory(path);
  return (index) => {
    const context = map.contextAt(index);
    if (context !== "prose" && context !== "inline") return false;
    return directory || DEMOTED_HEADING.test(map.headingAt(index) ?? "");
  };
};
