import * as p from "@clack/prompts";
import { missingDeps, referrersTo, type MissingDep } from "../core/skill/deps.ts";
import { pathInRoot, type DiscoveredSkill } from "../core/source/discover.ts";
import type { SkillFile } from "../core/skill/files.ts";
import { emptyLock, readLock, splitDisabled, type Lockfile } from "../core/install/lockfile.ts";
import type { AgentId } from "../core/install/agents.ts";
import {
  lackingAgents,
  updateDestination,
  type InstalledSkill,
} from "../core/install/destination.ts";
import { storedFiles } from "../core/install/store.ts";
import type { Scope } from "../core/paths.ts";
import { otherScope, scopeFlag } from "../core/install/scope.ts";
import { fitsRefSuffix } from "../core/source/coordinate.ts";
import { discoveryCoordinate, type Changes, type DiscoveryLocation } from "../core/source/index.ts";
import type { Revision } from "../core/source/revision.ts";
import type { OutdatedVerdict } from "../core/source/upstream.ts";
import { withSpinner } from "./prompt.ts";
import { logWarn, warn } from "./report.ts";
import { dim, skillName } from "./style.ts";

export const warnMentions = (missing: MissingDep[], note: string): void => {
  for (const dep of missing) {
    warn(
      `${skillName(dep.from)} mentions ${skillName(dep.name)} at ${dep.file}:${dep.line}. ${note}.`,
    );
  }
};

export const warnReferrers = async (
  survivors: InstalledSkill[],
  targets: string[],
): Promise<void> => {
  const batch = await Promise.all(
    survivors
      .filter((skill) => !targets.includes(skill.name))
      .map(async ({ name, source, path, integrity }) => ({
        name,
        source,
        path,
        files: await storedFiles(source, name, integrity).catch((e: Error) => {
          logWarn(`${skillName(name)}: mention check skipped. ${e.message}`);
          return [];
        }),
      })),
  );
  const known = targets.map((name) => survivors.find((skill) => skill.name === name) ?? { name });
  for (const [target, referrers] of referrersTo(batch, known)) {
    warn(`${skillName(target)} is referenced by ${referrers.map(skillName).join(", ")}`);
  }
};

export const reportNotInstalled = (
  missing: MissingDep[],
  discovered: DiscoveryLocation,
  scope: Scope,
  ref?: string,
): void => {
  warnMentions(missing, "not installed");
  const coordinate = discoveryCoordinate(discovered);
  if (coordinate === undefined) {
    warn("Cannot generate a rooted add command without a source revision.");
    return;
  }
  const selectors = missing.map((dep) =>
    dep.path === undefined ? dep.name : pathInRoot(discovered.root, dep.path),
  );
  const at = ref === undefined ? "" : `@${ref}`;
  p.log.info(
    `Add them: ${dim(`nik add ${coordinate}${at} ${selectors.join(" ")}${scopeFlag(scope)}`)}`,
  );
};

export interface OtherScopeLock {
  scope: Scope;
  enabled: Lockfile;
}

export const readOtherScopeLock = async (scope: Scope): Promise<OtherScopeLock> => {
  const other = otherScope(scope);
  try {
    return { scope: other, enabled: splitDisabled(await readLock(other)).enabled };
  } catch (e) {
    logWarn(`${(e as Error).message}\nDependency check ignores ${other} scope.`);
    return { scope: other, enabled: emptyLock() };
  }
};

export const reportRecordedElsewhere = async (
  missing: MissingDep[],
  other: OtherScopeLock,
  agents: AgentId[],
): Promise<MissingDep[]> => {
  const remaining: MissingDep[] = [];
  for (const dep of missing) {
    const entry = other.enabled.skills[dep.name];
    if (
      agents.length === 0 ||
      entry === undefined ||
      (await lackingAgents({ ...entry, name: dep.name }, other.scope, agents)).length > 0
    ) {
      remaining.push(dep);
      continue;
    }
    p.log.info(
      `${skillName(dep.from)} mentions ${skillName(dep.name)}, recorded in ${other.scope} scope.`,
    );
  }
  return remaining;
};

export interface UpdatedFiles {
  verdict: OutdatedVerdict;
  files: SkillFile[];
  diff: Changes;
}

const discoveryKey = ({ source, skill, upstream }: OutdatedVerdict): string =>
  JSON.stringify([
    skill.source,
    source.kind === "local" ? null : upstream.commit,
    skill.branch,
    skill.root,
  ]);

const pinnedRef = ({ pinnedAs, commit }: Revision): string | undefined =>
  pinnedAs !== undefined && fitsRefSuffix(pinnedAs) ? pinnedAs : commit;

export const reportUpdateDeps = async (
  updated: UpdatedFiles[],
  lock: Lockfile,
  other: OtherScopeLock,
  scope: Scope,
): Promise<void> => {
  const groups = Map.groupBy(updated, (item) => discoveryKey(item.verdict));
  for (const group of groups.values()) {
    const { source, upstream, skill } = group[0]!.verdict;
    let known: DiscoveredSkill[];
    try {
      known = await withSpinner(
        `Checking ${source.display} for dependencies`,
        () => source.discover(upstream.commit, skill.root),
        () => null,
      );
    } catch (e) {
      logWarn(`${source.display}: dependency check skipped. ${(e as Error).message}`);
      continue;
    }
    const inBatch = new Set(group.map((item) => item.verdict.skill.name));
    const missing = new Map<string, MissingDep>();
    const mentionedByAuto = new Set<string>();
    for (const item of group) {
      const { destination } = await updateDestination(item.verdict.skill, scope, lock);
      const mentioned = missingDeps(
        [{ ...item.verdict.skill, files: item.files }],
        known,
        (name) => lock.skills[name] !== undefined || inBatch.has(name),
      );
      const remaining = await reportRecordedElsewhere(
        mentioned,
        other,
        destination.kind === "path-copy" ? [] : destination.agents,
      );
      for (const dep of remaining) {
        missing.set(dep.name, dep);
        if (item.verdict.skill.track !== "pin") mentionedByAuto.add(dep.name);
      }
    }
    reportGroupHints(group, [...missing.values()], mentionedByAuto, scope);
  }
};

const reportGroupHints = (
  group: UpdatedFiles[],
  missing: MissingDep[],
  mentionedByAuto: Set<string>,
  scope: Scope,
): void => {
  const location = group[0]!.verdict.skill;
  const atLatest = missing.filter((dep) => mentionedByAuto.has(dep.name));
  const atReviewed = missing.filter((dep) => !mentionedByAuto.has(dep.name));
  if (atLatest.length > 0) reportNotInstalled(atLatest, location, scope);
  if (atReviewed.length > 0) {
    const { upstream } = group.find((item) => item.verdict.skill.track === "pin")!.verdict;
    reportNotInstalled(atReviewed, location, scope, pinnedRef(upstream));
  }
};
