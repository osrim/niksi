import type { InstalledSkill } from "../install/destination.ts";
import type { Revision } from "./revision.ts";
import { sourceFor, type Source } from "./index.ts";
import { waitsForCooldown, type Cooldown } from "./release-age.ts";

interface Verdict {
  skill: InstalledSkill;
  source: Source;
  upstream: Revision;
  ahead: number;
  age?: number;
}

export interface UnreachableVerdict extends Verdict {
  kind: "unreachable";
  error: string;
}

export interface GoneVerdict extends Verdict {
  kind: "gone";
}

export interface RewrittenVerdict extends Verdict {
  kind: "rewritten";
  pinnedAs: string;
  expected: string;
  actual: string;
}

export interface PinnedVerdict extends Verdict {
  kind: "pinned";
}

export interface MovedVerdict extends Verdict {
  kind: "moved";
  waiting?: boolean;
}

export interface OutdatedVerdict extends Verdict {
  kind: "outdated";
  waiting?: boolean;
}

export type UpdatableVerdict = MovedVerdict | OutdatedVerdict;

export interface UpToDateVerdict extends Verdict {
  kind: "up-to-date";
}

export type UpdateVerdict =
  | UnreachableVerdict
  | GoneVerdict
  | RewrittenVerdict
  | PinnedVerdict
  | MovedVerdict
  | OutdatedVerdict
  | UpToDateVerdict;

export const computeVerdicts = (
  skills: InstalledSkill[],
  named: string[],
  cooldown: Cooldown,
): Promise<UpdateVerdict[]> => {
  const names = new Set(named);
  return Promise.all(skills.map((skill) => verdictOf(skill, names, cooldown)));
};

const verdictOf = async (
  skill: InstalledSkill,
  names: Set<string>,
  cooldown: Cooldown,
): Promise<UpdateVerdict> => {
  const source = sourceFor(skill.source);
  try {
    return await classify(skill, source, names.has(skill.name), cooldown);
  } catch (e) {
    return {
      kind: "unreachable",
      skill,
      source,
      upstream: { track: skill.track },
      ahead: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
};

const ageSince = (committedAt: number | undefined, now: number): { age?: number } =>
  committedAt === undefined ? {} : { age: now - committedAt };

const waits = ({ age }: { age?: number }, named: boolean, days: number): boolean =>
  !named && age !== undefined && waitsForCooldown(age, days);

const classify = async (
  skill: InstalledSkill,
  source: Source,
  named: boolean,
  cooldown: Cooldown,
): Promise<UpdateVerdict> => {
  const { revision: upstream, committedAt, ...flags } = await source.upstream(skill);
  const verdict = {
    skill,
    source,
    upstream,
    ahead: flags.ahead,
    ...ageSince(committedAt, cooldown.now),
  };
  const rewritten = await rewrittenRef(skill, source);
  if (rewritten) return { kind: "rewritten", ...verdict, ...rewritten };
  if (flags.gone) return { kind: "gone", ...verdict };
  if (!flags.outdated && !flags.moved) return { kind: "up-to-date", ...verdict };
  if (skill.track === "pin" && !named) return { kind: "pinned", ...verdict };
  const waiting = waits(verdict, named, cooldown.days);
  return { kind: flags.moved ? "moved" : "outdated", ...verdict, waiting };
};

export const holdsBack = (verdict: UpdatableVerdict, names: string[]): boolean =>
  names.length === 0 && verdict.waiting === true;

interface RewrittenRef {
  pinnedAs: string;
  expected: string;
  actual: string;
}

const rewrittenRef = async (
  skill: InstalledSkill,
  source: Source,
): Promise<RewrittenRef | undefined> => {
  if (skill.track !== "pin" || !skill.pinnedAs || !skill.commit) return;
  try {
    const actual = (await source.resolve(skill.pinnedAs)).commit ?? "";
    return actual === skill.commit
      ? undefined
      : { pinnedAs: skill.pinnedAs, expected: skill.commit, actual };
  } catch {
    return;
  }
};

interface UpdateSelection {
  selected: UpdatableVerdict[];
  skipped: string[];
  needsPrompt: boolean;
}

export const requestedNames = (
  skills: InstalledSkill[],
  names: string[],
  all: boolean,
): string[] | undefined => {
  if (names.length > 0) return names;
  if (!all) return undefined;
  return skills.filter((skill) => skill.track !== "pin").map((skill) => skill.name);
};

export const selectUpdates = (
  candidates: UpdatableVerdict[],
  names: string[],
  all: boolean,
): UpdateSelection => {
  const requested = requestedNames(
    candidates.map((verdict) => verdict.skill),
    names,
    all,
  );
  if (!requested) return { selected: [], skipped: [], needsPrompt: true };
  const selected = candidates.filter(
    (verdict) => requested.includes(verdict.skill.name) && !holdsBack(verdict, names),
  );
  const skipped = requested.filter(
    (name) => !selected.some((verdict) => verdict.skill.name === name),
  );
  return { selected, skipped, needsPrompt: false };
};
