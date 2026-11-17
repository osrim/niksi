import { integrityHex } from "../skill/integrity.ts";
import { commitTime, defaultBranch, headCommit, isBranch, listTags, resolveRef } from "./git.ts";
import { pickLatestTag } from "./semver.ts";
import { repoName } from "./coordinate.ts";

export interface Revision {
  commit?: string;
  branch?: string;
  track: "auto" | "pin";
  pinnedAs?: string;
  tag?: string;
}

export const COMMIT_HASH = /^[0-9a-f]{40}$/u;

export const shortId = (entry: { commit?: string; integrity?: string }): string =>
  (entry.commit ?? (entry.integrity === undefined ? "" : integrityHex(entry.integrity))).slice(
    0,
    8,
  );

export interface Labelled {
  pinnedAs?: string;
  tag?: string;
  commit?: string;
  integrity?: string;
}

export const displayLabel = (entry: Labelled): string =>
  entry.pinnedAs ?? entry.tag ?? shortId(entry);

// A source that still commits to its branch long after its latest stable tag no longer releases.
const STALE_TAG_SECONDS = 365 * 86_400;

const isStale = async (clone: string, tag: string, head: string): Promise<boolean> => {
  const [taggedAt, headAt] = await Promise.all([commitTime(clone, tag), commitTime(clone, head)]);
  return headAt - taggedAt > STALE_TAG_SECONDS;
};

export const resolveUpstream = async (
  clone: string,
  repo: string,
  branch: string,
  track: Revision["track"] = "auto",
): Promise<{ commit: string; tag?: string }> => {
  const latest = pickLatestTag(await listTags(clone), repoName(repo));
  if (!latest) return { commit: await headCommit(clone, branch) };
  const tagged = { commit: latest.commit, tag: latest.name };
  if (track === "pin") return tagged;
  // A recorded branch that upstream renamed leaves nothing to compare the tag with.
  const head = await headCommit(clone, branch).catch(() => null);
  return head !== null && (await isStale(clone, latest.commit, head)) ? { commit: head } : tagged;
};

export const resolveRevision = async (
  clone: string,
  repo: string,
  userRef?: string,
): Promise<Revision> => {
  if (userRef) {
    const commit = await resolveRef(clone, userRef);
    const branchPin = await isBranch(clone, userRef);
    return {
      commit,
      branch: branchPin ? userRef : await defaultBranch(clone),
      track: "pin",
      ...(branchPin || COMMIT_HASH.test(userRef) ? {} : { pinnedAs: userRef }),
    };
  }
  const branch = await defaultBranch(clone);
  const { commit, tag } = await resolveUpstream(clone, repo, branch);
  return { commit, branch, track: "auto", ...(tag ? { tag } : {}) };
};
