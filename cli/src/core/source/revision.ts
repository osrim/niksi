import { integrityHex } from "../skill/integrity.ts";
import {
  commitTime,
  defaultBranch,
  headCommit,
  isAncestor,
  isBranch,
  listTags,
  resolveRef,
} from "./git.ts";
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

// A source that keeps committing to its branch long after its latest stable tag no longer releases.
const ABANDONED_TAG_SECONDS = 365 * 86_400;

const isAbandoned = async (clone: string, taggedCommit: string, head: string): Promise<boolean> => {
  const [taggedAt, headAt] = await Promise.all([
    commitTime(clone, taggedCommit),
    commitTime(clone, head),
  ]);
  return headAt - taggedAt > ABANDONED_TAG_SECONDS;
};

type Installed = Pick<Revision, "track" | "commit" | "tag">;

// A skill on the branch goes back to tags only at a tag known to contain its commit, so a fix tagged
// on an older release line can't take back the branch's changes, even after upstream rewrites
// history and drops the installed commit.
const leavesBranch = async (
  clone: string,
  installed: Installed,
  taggedCommit: string,
): Promise<boolean> =>
  installed.commit !== undefined &&
  installed.tag === undefined &&
  !(await isAncestor(clone, installed.commit, taggedCommit));

export const resolveUpstream = async (
  clone: string,
  repo: string,
  branch: string,
  installed: Installed = { track: "auto" },
): Promise<{ commit: string; tag?: string }> => {
  const latest = pickLatestTag(await listTags(clone), repoName(repo));
  if (!latest) return { commit: await headCommit(clone, branch) };
  const tagged = { commit: latest.commit, tag: latest.name };
  if (installed.track === "pin") return tagged;
  // A recorded branch that upstream renamed leaves nothing to compare the tag with.
  const head = await headCommit(clone, branch).catch(() => null);
  if (head === null) return tagged;
  const followsHead =
    (await isAbandoned(clone, latest.commit, head)) ||
    (await leavesBranch(clone, installed, latest.commit));
  return followsHead ? { commit: head } : tagged;
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
