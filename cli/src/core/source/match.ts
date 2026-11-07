import { posix } from "node:path";
import { parse } from "yaml";
import type { SkillFile } from "../skill/files.ts";
import { integrityOf } from "../skill/integrity.ts";
import type { PastContent, Source } from "./index.ts";
import type { Revision } from "./revision.ts";

export interface Wanted {
  name: string;
  files: SkillFile[];
  path?: string | undefined;
  pinned?: string | undefined;
  tree?: string | undefined;
}

export interface Match {
  path: string;
  revision: Revision;
  files: SkillFile[];
  integrity: string;
}

interface SkillMd {
  fields: Record<string, unknown>;
  body: string;
}

// The keys that gh skill writes or deletes in `metadata`, from cli/cli internal/skills/frontmatter.
const GH_SKILL_KEYS = new Set([
  "github-owner",
  "github-repo",
  "github-ref",
  "github-sha",
  "github-tree-sha",
  "github-path",
  "github-pinned",
]);

const isMapping = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseMapping = (yaml: string): Record<string, unknown> | undefined => {
  try {
    const doc: unknown = parse(yaml) ?? {};
    return isMapping(doc) ? { ...doc } : undefined;
  } catch {
    return undefined;
  }
};

// Splits SKILL.md the way gh skill does before it rewrites the frontmatter.
const readSkillMd = (text: string): SkillMd | undefined => {
  const trimmed = text.replace(/^[\r\n]+/u, "");
  if (!trimmed.startsWith("---")) return undefined;
  const rest = trimmed.slice(3).replace(/^[\r\n]+/u, "");
  const end = rest.indexOf("\n---");
  if (end < 0) return undefined;
  const fields = parseMapping(rest.slice(0, end));
  if (fields === undefined) return undefined;
  const body = rest.slice(end + 4).replace(/^[\r\n]+/u, "");
  return { fields, body: body === "" || body.endsWith("\n") ? body : `${body}\n` };
};

// True when gh skill keys were present. Drops them, and `metadata` when nothing else is left.
const dropGhSkillKeys = (fields: Record<string, unknown>): boolean => {
  const metadata = fields["metadata"];
  if (!isMapping(metadata)) return false;
  const kept = Object.entries(metadata).filter(([key]) => !GH_SKILL_KEYS.has(key));
  if (kept.length === Object.keys(metadata).length) return false;
  if (kept.length > 0) fields["metadata"] = Object.fromEntries(kept);
  else delete fields["metadata"];
  return true;
};

const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, inner: unknown) =>
    isMapping(inner)
      ? Object.fromEntries(Object.entries(inner).toSorted(([a], [b]) => (a < b ? -1 : 1)))
      : inner,
  );

const skillMdOf = (files: SkillFile[]): SkillFile | undefined =>
  files.find((file) => file.path === "SKILL.md");

const withoutSkillMd = (files: SkillFile[]): SkillFile[] =>
  files.filter((file) => file.path !== "SKILL.md");

const sameGhSkillMd = (mine: SkillFile, theirs: SkillFile): boolean => {
  if (mine.mode !== theirs.mode) return false;
  const a = readSkillMd(mine.content.toString("utf8"));
  const b = readSkillMd(theirs.content.toString("utf8"));
  if (a === undefined || b === undefined || !dropGhSkillKeys(a.fields)) return false;
  return a.body === b.body && canonical(a.fields) === canonical(b.fields);
};

// Equal files, or a gh skill copy whose SKILL.md differs only by gh's keys and YAML layout.
export const sameContent = (local: SkillFile[], upstream: SkillFile[]): boolean => {
  if (integrityOf(local) === integrityOf(upstream)) return true;
  if (integrityOf(withoutSkillMd(local)) !== integrityOf(withoutSkillMd(upstream))) return false;
  const mine = skillMdOf(local);
  const theirs = skillMdOf(upstream);
  return mine !== undefined && theirs !== undefined && sameGhSkillMd(mine, theirs);
};

// A followed revision also looks at the branch head, which can hold skills added after the release.
const discoveryCommits = async (
  source: Source,
  rev: Revision,
): Promise<Array<string | undefined>> => {
  if (rev.track === "pin" || rev.branch === undefined) return [rev.commit];
  const head = (await source.resolve(rev.branch)).commit;
  return head === rev.commit ? [rev.commit] : [rev.commit, head];
};

const candidatePaths = async (source: Source, rev: Revision, want: Wanted): Promise<string[]> => {
  if (want.path !== undefined) return [want.path];
  const paths = new Set<string>();
  for (const commit of await discoveryCommits(source, rev)) {
    for (const skill of await source.discover(commit)) {
      if (skill.name === want.name || posix.basename(skill.path) === want.name)
        paths.add(skill.path);
    }
  }
  return [...paths];
};

// The tree that another installer recorded is the likeliest match, so it is read first.
const byHint = (history: PastContent[], tree: string | undefined): PastContent[] =>
  tree === undefined
    ? history
    : [
        ...history.filter((past) => past.tree === tree),
        ...history.filter((past) => past.tree !== tree),
      ];

const revisionOf = (rev: Revision, commit: string | undefined): Revision =>
  commit === rev.commit
    ? rev
    : {
        ...(commit === undefined ? {} : { commit }),
        ...(rev.branch === undefined ? {} : { branch: rev.branch }),
        track: rev.track,
      };

const matchAt = async (
  source: Source,
  rev: Revision,
  path: string,
  want: Wanted,
): Promise<Match | undefined> => {
  for (const past of byHint(await source.history(rev, path), want.tree)) {
    const files = await source.fetchFiles(past.commit, path);
    if (files.length === 0 || !sameContent(want.files, files)) continue;
    return { path, revision: revisionOf(rev, past.commit), files, integrity: integrityOf(files) };
  }
  return undefined;
};

export const matchSkill = async (source: Source, want: Wanted): Promise<Match | undefined> => {
  const rev = await source.resolve(want.pinned);
  for (const path of await candidatePaths(source, rev, want)) {
    const match = await matchAt(source, rev, path, want);
    if (match) return match;
  }
  return undefined;
};
