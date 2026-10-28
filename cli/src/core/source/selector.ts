import { parseSource, type Coordinate } from "./coordinate.ts";
import { LOCAL_PREFIX, sourceMatches } from "./index.ts";
import { USAGE_ERROR, usageError } from "../usage.ts";

export type SourceSelector = { kind: "local" } | { kind: "coordinate"; coordinate: Coordinate };

const LOCAL_KEYWORD = "local";

const SELECTOR_REMEDY = `Pass ${LOCAL_KEYWORD}, or the source alone: owner/repo, a Git URL, or a local path.`;

export const parseSourceSelector = (raw: string): SourceSelector => {
  const value = raw.trim();
  if (value === "") throw usageError(`Pass a source to --source.\n${SELECTOR_REMEDY}`);
  if (value === LOCAL_KEYWORD) return { kind: "local" };
  try {
    return { kind: "coordinate", coordinate: parseSource(value, SELECTOR_REMEDY) };
  } catch (e) {
    if ((e as Error).name === USAGE_ERROR) throw e;
    throw usageError(`${(e as Error).message}\n${SELECTOR_REMEDY}`);
  }
};

export const describeSelector = (selector: SourceSelector): string =>
  selector.kind === "local" ? LOCAL_KEYWORD : selector.coordinate.repo;

export const selectsSource = (
  selector: SourceSelector,
  skill: { source: string; path: string },
): boolean =>
  selector.kind === "local"
    ? skill.source.startsWith(LOCAL_PREFIX)
    : sourceMatches(skill, selector.coordinate);
