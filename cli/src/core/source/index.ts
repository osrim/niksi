import { realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { projectRoot, type Scope } from "../paths.ts";
import type { DiscoveredSkill } from "./discover.ts";
import type { SourceKind, Coordinate } from "./coordinate.ts";
import type { Revision } from "./revision.ts";
import type { SkillFile } from "../skill/files.ts";
import type { InstalledSkill } from "../install/destination.ts";
import { GitSource } from "./git-source.ts";
import { LocalSource } from "./local-source.ts";

export const LOCAL_PREFIX = "local:";

export interface Upstream {
  revision: Revision;
  outdated: boolean;
  moved: boolean;
  gone: boolean;
  ahead: number;
}

export interface Changes {
  stat: string;
  patch: string;
}

export interface Anchored {
  source: Source;
  root: string;
}

export interface Source {
  readonly kind: SourceKind;
  readonly display: string;
  readonly id: string;

  forScope(scope: Scope): Anchored;
  resolve(userRef?: string): Promise<Revision>;
  upstream(skill: InstalledSkill): Promise<Upstream>;
  discover(rev: string | undefined, root?: string): Promise<DiscoveredSkill[]>;
  splitTree(segments: string[]): Promise<{ ref?: string; dir: string }>;
  fetchFiles(rev: string | undefined, path: string): Promise<SkillFile[]>;
  changes(from: InstalledSkill, to: string | undefined, before: string): Promise<Changes>;
}

export const sourceFor = (id: string, base?: string): Source => {
  if (id.startsWith(LOCAL_PREFIX)) {
    const dir = id.slice(LOCAL_PREFIX.length);
    return new LocalSource(isAbsolute(dir) ? dir : resolve(base ?? projectRoot(), dir));
  }
  return new GitSource(id);
};

export const sourceForCoordinate = (coordinate: Coordinate): Source =>
  coordinate.kind === "local" ? new LocalSource(coordinate.repo) : new GitSource(coordinate.repo);

export interface ResolvedCoordinate {
  rev: Revision;
  skills: DiscoveredSkill[];
  dir: string;
  ref: string | undefined;
}

export const resolveCoordinate = async (
  source: Source,
  coordinate: Coordinate,
): Promise<ResolvedCoordinate> => {
  let dir = "";
  let ref = coordinate.ref;
  if (coordinate.tree) {
    const split = await source.splitTree(coordinate.tree);
    dir = split.dir;
    ref ??= split.ref;
  }
  const rev = await source.resolve(ref);
  return { rev, skills: await source.discover(rev.commit, dir), dir, ref };
};

export interface ScopedCoordinate {
  source: Source;
  root: string;
  skills: DiscoveredSkill[];
}

export const scopeCoordinate = (
  source: Source,
  scope: Scope,
  found: { root: string; skills: DiscoveredSkill[] },
): ScopedCoordinate => {
  const anchored = source.forScope(scope);
  const inAnchor = (path: string): string => [anchored.root, path].filter(Boolean).join("/");
  return {
    source: anchored.source,
    root: inAnchor(found.root),
    skills: found.skills.map((skill) => ({ ...skill, path: inAnchor(skill.path) })),
  };
};

const realOrGiven = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

const within = (parent: string, child: string): boolean => {
  const rel = relative(realOrGiven(parent), realOrGiven(child));
  return !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`);
};

export const insideProject = (dir: string): boolean => within(projectRoot(), dir);

export const localAnchor = (
  dir: string,
  scope: Scope,
): { dir: string; id: string; root: string } => {
  const anchor = scope === "project" && insideProject(dir) ? realOrGiven(projectRoot()) : "/";
  return {
    dir: anchor,
    id: `${LOCAL_PREFIX}${anchor === "/" ? "/" : "."}`,
    root: relative(anchor, realOrGiven(dir)),
  };
};

export const coordinateFor = (sourceId: string): string =>
  sourceId.startsWith(LOCAL_PREFIX)
    ? resolve(projectRoot(), sourceId.slice(LOCAL_PREFIX.length))
    : sourceId;

export const discoveryCoordinate = (
  skill: Pick<InstalledSkill, "source" | "branch" | "root" | "pinnedAs" | "tag" | "commit">,
): string | undefined => {
  const coordinate = coordinateFor(skill.source);
  if (!skill.root) return coordinate;
  if (skill.source.startsWith(LOCAL_PREFIX)) return join(coordinate, skill.root);
  const ref = skill.branch || skill.pinnedAs || skill.tag || skill.commit;
  if (!ref) return undefined;
  const segments = [...ref.split("/"), ...skill.root.split("/")];
  return `${coordinate}/tree/${segments.map(encodeURIComponent).join("/")}`;
};

interface Located {
  source: string;
  path: string;
}

const isLocal = (skill: Located): boolean => skill.source.startsWith(LOCAL_PREFIX);

const localDir = (skill: Located): string =>
  realOrGiven(join(coordinateFor(skill.source), skill.path));

export const sameSkill = (a: Located, b: Located): boolean =>
  isLocal(a) && isLocal(b)
    ? localDir(a) === localDir(b)
    : a.source === b.source && a.path === b.path;

export const sourceMatches = (skill: Located, coordinate: Coordinate): boolean =>
  coordinate.kind === "local"
    ? isLocal(skill) && within(coordinate.repo, localDir(skill))
    : skill.source === coordinate.repo;
