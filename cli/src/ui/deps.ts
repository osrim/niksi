import * as p from "@clack/prompts";
import { missingDeps, type MissingDep } from "../core/skill/deps.ts";
import type { DiscoveredSkill } from "../core/source/discover.ts";
import type { SkillFile } from "../core/skill/files.ts";
import { emptyLock, readLock, splitDisabled, type Lockfile } from "../core/install/lockfile.ts";
import type { AgentId } from "../core/install/agents.ts";
import { lackingAgents, updateDestination } from "../core/install/destination.ts";
import type { Scope } from "../core/paths.ts";
import { otherScope, scopeFlag } from "../core/install/scope.ts";
import { discoveryCoordinate, type Changes } from "../core/source/index.ts";
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

export const reportNotInstalled = (
  missing: MissingDep[],
  coordinate: string | undefined,
  scope: Scope,
): void => {
  warnMentions(missing, "not installed");
  if (coordinate === undefined) {
    warn("Cannot generate a rooted add command without a source revision.");
    return;
  }
  p.log.info(
    `Add them: ${dim(`nik add ${coordinate} ${missing.map((dep) => dep.name).join(" ")}${scopeFlag(scope)}`)}`,
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
    const knownNames = known.map((candidate) => candidate.name);
    const inBatch = new Set(group.map((item) => item.verdict.skill.name));
    const missing = new Map<string, MissingDep>();
    for (const item of group) {
      const { destination } = await updateDestination(item.verdict.skill, scope, lock);
      const mentioned = missingDeps(
        [{ name: item.verdict.skill.name, files: item.files }],
        knownNames,
        (name) => lock.skills[name] !== undefined || inBatch.has(name),
      );
      const remaining = await reportRecordedElsewhere(
        mentioned,
        other,
        destination.kind === "path-copy" ? [] : destination.agents,
      );
      for (const dep of remaining) missing.set(dep.name, dep);
    }
    if (missing.size > 0) {
      reportNotInstalled([...missing.values()], discoveryCoordinate(skill), scope);
    }
  }
};
