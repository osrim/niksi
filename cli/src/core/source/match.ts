import { posix } from "node:path";
import { parse } from "yaml";
import type { SkillFile } from "../skill/files.ts";
import { integrityOf } from "../skill/integrity.ts";
import type { Source, SourceVersion } from "./index.ts";
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
  tracked: boolean;
}

// Splits SKILL.md the way gh skill does before it rewrites the frontmatter, and drops its keys.
const readSkillMd = (text: string): SkillMd | undefined => {
  const trimmed = text.replace(/^[\r\n]+/u, "");
  if (!trimmed.startsWith("---")) return undefined;
  const rest = trimmed.slice(3).replace(/^[\r\n]+/u, "");
  const end = rest.indexOf("\n---");
  if (end < 0) return undefined;
  let body = rest.slice(end + 4).replace(/^[\r\n]+/u, "");
  if (body !== "" && !body.endsWith("\n")) body += "\n";
  let doc: unknown;
  try {
    doc = parse(rest.slice(0, end)) ?? {};
  } catch {
    return undefined;
  }
  if (typeof doc !== "object" || Array.isArray(doc)) return undefined;
  const fields = { ...(doc as Record<string, unknown>) };
  const metadata = fields["metadata"];
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    return { fields, body, tracked: false };
  }
  const kept = Object.entries(metadata).filter(([key]) => !key.startsWith("github-"));
  const tracked = kept.length < Object.keys(metadata).length;
  if (kept.length > 0) fields["metadata"] = Object.fromEntries(kept);
  else delete fields["metadata"];
  return { fields, body, tracked };
};

const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, inner: unknown) =>
    typeof inner === "object" && inner !== null && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).toSorted(([a], [b]) => (a < b ? -1 : 1)))
      : inner,
  );

const skillMdOf = (files: SkillFile[]): SkillFile | undefined =>
  files.find((file) => file.path === "SKILL.md");

const withoutSkillMd = (files: SkillFile[]): SkillFile[] =>
  files.filter((file) => file.path !== "SKILL.md");

// Equal files, or a gh skill copy whose SKILL.md differs only by gh's tracking keys and layout.
export const sameContent = (local: SkillFile[], upstream: SkillFile[]): boolean => {
  if (integrityOf(local) === integrityOf(upstream)) return true;
  const mine = skillMdOf(local);
  const theirs = skillMdOf(upstream);
  if (!mine || !theirs || mine.mode !== theirs.mode) return false;
  if (integrityOf(withoutSkillMd(local)) !== integrityOf(withoutSkillMd(upstream))) return false;
  const a = readSkillMd(mine.content.toString("utf8"));
  const b = readSkillMd(theirs.content.toString("utf8"));
  if (!a?.tracked || !b) return false;
  return a.body === b.body && canonical(a.fields) === canonical(b.fields);
};

const candidatePaths = async (source: Source, rev: Revision, want: Wanted): Promise<string[]> => {
  if (want.path !== undefined) return [want.path];
  const skills = await source.discover(rev.commit);
  return skills
    .filter((skill) => skill.name === want.name || posix.basename(skill.path) === want.name)
    .map((skill) => skill.path);
};

// The tree that another installer recorded is the likeliest match, so it is read first.
const byHint = (versions: SourceVersion[], tree: string | undefined): SourceVersion[] =>
  tree === undefined
    ? versions
    : [
        ...versions.filter((version) => version.tree === tree),
        ...versions.filter((version) => version.tree !== tree),
      ];

const matchAt = async (
  source: Source,
  rev: Revision,
  path: string,
  want: Wanted,
): Promise<Match | undefined> => {
  const versions = await source.versions(rev, path);
  for (const version of byHint(versions, want.tree)) {
    const files = await source.fetchFiles(version.commit, path);
    if (files.length === 0 || !sameContent(want.files, files)) continue;
    const revision: Revision =
      version === versions[0]
        ? rev
        : {
            ...(version.commit === undefined ? {} : { commit: version.commit }),
            ...(rev.branch === undefined ? {} : { branch: rev.branch }),
            track: rev.track,
          };
    return { path, revision, files, integrity: integrityOf(files) };
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
