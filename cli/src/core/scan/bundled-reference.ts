import type { SkillFile } from "../skill/files.ts";
import { lineOf, lineStarts } from "../skill/text.ts";
import { namedPaths } from "./archive.ts";
import type { LocalLink } from "./confusable-host.ts";

const FETCH = /\b(?:curl|wget|fetch)\b/gu;

// Whether a download command comes earlier on the line of `index`. The commands and the line
// starts are found once per text, so a line of many links is not reread for each one.
const fetchBefore = (text: string): ((index: number) => boolean) => {
  let found: { starts: number[]; ends: number[]; lines: number[] } | undefined;
  const find = () => {
    const matches = [...text.matchAll(FETCH)];
    return {
      starts: matches.map((match) => match.index),
      ends: matches.map((match) => match.index + match[0].length),
      lines: lineStarts(text),
    };
  };
  return (index) => {
    found ??= find();
    const last = lineOf(found.ends, index);
    const end = found.ends[last];
    if (end === undefined || end > index) return false;
    return found.starts[last]! >= found.lines[lineOf(found.lines, index)]!;
  };
};

export const bundledPaths = (files: SkillFile[]): Set<string> =>
  new Set(files.map((file) => file.path.toLowerCase()));

// A link without a scheme that names a bundled file, such as `Editor.app/Contents/Info.plist`, is
// a local path, unless a download command comes before it on its line.
export const bundledReference = (
  file: SkillFile,
  text: string,
  bundled: Set<string>,
): ((link: LocalLink) => boolean) => {
  const namesBundledFile = (name: string): boolean => {
    const path = name.split(/[?#]/u)[0]!.toLowerCase();
    return namedPaths(file, path).some((named) => bundled.has(named.toLowerCase()));
  };
  const fetched = fetchBefore(text);
  return (link) => link.schema === "" && namesBundledFile(link.text) && !fetched(link.index);
};
