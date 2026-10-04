import * as p from "@clack/prompts";
import { missingDeps, type MissingDep } from "../core/skill/deps.ts";
import type { DiscoveredSkill } from "../core/source/discover.ts";
import type { SkillFile } from "../core/skill/files.ts";
import type { Lockfile } from "../core/install/lockfile.ts";
import type { Scope } from "../core/paths.ts";
import { scopeFlag } from "../core/install/scope.ts";
import { coordinateFor, type Changes } from "../core/source/index.ts";
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

export const reportNotInstalled = (missing: MissingDep[], sourceId: string, scope: Scope): void => {
  warnMentions(missing, "not installed");
  p.log.info(
    `Add them: ${dim(`nik add ${coordinateFor(sourceId)} ${missing.map((dep) => dep.name).join(" ")}${scopeFlag(scope)}`)}`,
  );
};

export interface UpdatedFiles {
  verdict: OutdatedVerdict;
  files: SkillFile[];
  diff: Changes;
}

const discoveryKey = (verdict: OutdatedVerdict): string =>
  verdict.source.kind === "local"
    ? verdict.skill.source
    : `${verdict.skill.source}@${verdict.upstream.commit}`;

export const reportUpdateDeps = async (
  updated: UpdatedFiles[],
  lock: Lockfile,
  scope: Scope,
): Promise<void> => {
  const groups = Map.groupBy(updated, (item) => discoveryKey(item.verdict));
  for (const group of groups.values()) {
    const { source, upstream, skill } = group[0]!.verdict;
    let known: DiscoveredSkill[];
    try {
      known = await withSpinner(
        `Checking ${source.display} for dependencies`,
        () => source.discover(upstream.commit),
        () => null,
      );
    } catch (e) {
      logWarn(`${source.display}: dependency check skipped. ${(e as Error).message}`);
      continue;
    }
    const missing = missingDeps(
      group.map((item) => ({ name: item.verdict.skill.name, files: item.files })),
      known.map((candidate) => candidate.name),
      (name) => lock.skills[name] !== undefined,
    );
    if (missing.length > 0) reportNotInstalled(missing, skill.source, scope);
  }
};
