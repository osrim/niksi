import type { MarkdownMap } from "../skill/markdown.ts";
import type { Severity } from "./index.ts";
import { lower } from "./severity.ts";
import type { Statement } from "./shell.ts";

export interface ProseJudge {
  afterProhibition: (index: number) => boolean;
  demoted: (index: number) => boolean;
}

const DEMOTED_DIRECTORIES = new Set(["references", "docs", "examples"]);

const DEMOTED_HEADING = /\b(?:demo(?:nstration)?s?|references?|anti-?patterns?)\b/iu;

// An archive member such as `tools.zip!docs/x.md` has the parts `tools.zip` and `docs/x.md`.
const directories = (parts: string[]): string[] =>
  parts.flatMap((part) => part.split("/")).slice(0, -1);

const inDemotedDirectory = (parts: string[]): boolean =>
  directories(parts).some((name) => DEMOTED_DIRECTORIES.has(name.toLowerCase()));

// Docs and demo prose describe a command rather than give it.
export const demotes = (parts: string[], map: MarkdownMap): ((index: number) => boolean) => {
  const directory = inDemotedDirectory(parts);
  return (index) => {
    const context = map.contextAt(index);
    if (context !== "prose" && context !== "inline") return false;
    return directory || DEMOTED_HEADING.test(map.headingAt(index) ?? "");
  };
};

export const judgeStatement = (
  { kind, index }: Pick<Statement, "kind" | "index">,
  { afterProhibition, demoted }: ProseJudge,
): { quiet: boolean; judged: (severity: Severity) => Severity } => {
  const prose = kind === "prose";
  const quiet = prose && afterProhibition(index);
  const lowered = kind === "comment" || (prose && demoted(index));
  return {
    quiet,
    judged: (severity) => (quiet ? "info" : lowered ? lower(severity) : severity),
  };
};
