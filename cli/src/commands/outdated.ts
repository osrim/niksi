import * as p from "@clack/prompts";
import { installedSkills, type InstalledSkill } from "../core/install/destination.ts";
import { loadLock, splitDisabled, type LoadedLockfile } from "../core/install/lockfile.ts";
import { resolveScope, scopeFlag, type ScopeOptions } from "../core/install/scope.ts";
import { outdatedExitCode, outdatedSkill } from "../core/outdated.ts";
import type { Scope } from "../core/paths.ts";
import { policyViolations, type PolicyViolation } from "../core/policy.ts";
import { readProjectConfig } from "../core/project-config.ts";
import { unixNow } from "../core/source/release-age.ts";
import { computeVerdicts, type UpdateVerdict } from "../core/source/upstream.ts";
import type { CommandHelp } from "../ui/help.ts";
import { migrateIfLegacy } from "../ui/migrate.ts";
import { withSpinner } from "../ui/prompt.ts";
import { logWarn } from "../ui/report.ts";
import {
  describeUpdate,
  emptyScopeMessage,
  logSourceBlocked,
  reportDisabled,
  reportVerdicts,
} from "../ui/status.ts";
import { dim, skillName } from "../ui/style.ts";

export const help: CommandHelp = {
  description:
    "Check upstream and show which skills have updates. Writes nothing and never asks. Exits 1 when a skill is not up to date.",
  examples: ["$ nik outdated", "$ nik outdated -g", "$ nik outdated --json"],
};

interface OutdatedOptions extends ScopeOptions {
  json?: boolean;
}

interface Checked {
  loaded: LoadedLockfile;
  skills: InstalledSkill[];
  disabled: string[];
  blocked: PolicyViolation[];
}

const byName = (a: { name: string }, b: { name: string }): number =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

const openScope = async (options: OutdatedOptions): Promise<Scope> => {
  const quiet = options.json === true;
  const scope = resolveScope(options, quiet ? logWarn : p.log.warn) ?? "project";
  await migrateIfLegacy(scope, quiet);
  return scope;
};

const allowedSkills = (skills: InstalledSkill[], blocked: PolicyViolation[]): InstalledSkill[] => {
  const names = new Set(blocked.map(({ name }) => name));
  return skills.filter(({ name }) => !names.has(name)).toSorted(byName);
};

const prepare = async (scope: Scope): Promise<Checked> => {
  const { policy } = await readProjectConfig(scope);
  const loaded = await loadLock(scope);
  const { enabled, disabled } = splitDisabled(loaded.lock);
  const installed = installedSkills(enabled);
  const blocked = policyViolations(policy, installed);
  return {
    loaded,
    skills: allowedSkills(installed, blocked),
    disabled: Object.keys(disabled.skills).toSorted(),
    blocked,
  };
};

const verdictsOf = (skills: InstalledSkill[]): Promise<UpdateVerdict[]> =>
  computeVerdicts(skills, [], { days: 0, now: unixNow() });

export const run = async (options: OutdatedOptions): Promise<void> => {
  if (options.json) return runJson(options);

  p.intro("nik outdated");
  const scope = await openScope(options);
  const { skills, ...check } = await prepare(scope);
  if (Object.keys(check.loaded.lock.skills).length === 0) {
    p.outro(await emptyScopeMessage(scope));
    return;
  }
  reportDisabled(check.disabled, scope);
  for (const violation of check.blocked) logSourceBlocked(violation);
  const verdicts =
    skills.length === 0
      ? []
      : await withSpinner(
          `Checking upstream for ${skills.length} skill(s)`,
          () => verdictsOf(skills),
          () => "Checked upstream sources",
        );
  process.exitCode = outdatedExitCode(verdicts, check.blocked.length);
  p.outro(reportCheck(verdicts, scope));
};

const reportCheck = (verdicts: UpdateVerdict[], scope: Scope): string => {
  const { moved, outdated } = reportVerdicts(verdicts, [], scope);
  const updatable = [...moved, ...outdated].toSorted((a, b) => byName(a.skill, b.skill));
  for (const verdict of updatable) {
    p.log.info(`${skillName(verdict.skill.name)}: ${describeUpdate(verdict)}`);
  }
  if (updatable.length > 0) {
    p.log.info(`Run ${dim(`nik update${scopeFlag(scope)}`)} to review and apply them.`);
  }
  return summaryLine(verdicts, scope);
};

const FAILED = new Set<UpdateVerdict["kind"]>(["unreachable", "gone", "rewritten"]);

const summaryLine = (verdicts: UpdateVerdict[], scope: Scope): string => {
  const failed = verdicts.filter(({ kind }) => FAILED.has(kind)).length;
  const updates = verdicts.filter(({ kind }) => kind !== "up-to-date" && !FAILED.has(kind)).length;
  const notes = [
    ...(updates > 0 ? [`${updates} with updates`] : []),
    ...(failed > 0 ? [`${failed} failed`] : []),
  ];
  const result = notes.length > 0 ? notes.join(", ") : "all up to date";
  return `${verdicts.length} skill(s) checked (${scope}): ${result}.`;
};

const runJson = async (options: OutdatedOptions): Promise<void> => {
  const scope = await openScope(options);
  const { skills, ...check } = await prepare(scope);
  for (const violation of check.blocked) logSourceBlocked(violation);
  const verdicts = await verdictsOf(skills);
  process.exitCode = outdatedExitCode(verdicts, check.blocked.length);
  console.log(
    JSON.stringify(
      {
        scope,
        lockfile: check.loaded.file,
        skills: verdicts.map(outdatedSkill),
        disabled: check.disabled,
        blocked: check.blocked.map(({ name }) => name),
      },
      null,
      2,
    ),
  );
};
