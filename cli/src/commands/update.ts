import * as p from "@clack/prompts";
import { stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { applySkill, type Applied, type Destination } from "../core/install/apply.ts";
import {
  loadLock,
  splitDisabled,
  type LoadedLockfile,
  type Lockfile,
} from "../core/install/lockfile.ts";
import {
  installedPath,
  installedSkills,
  modifiedSkills,
  updateDestination,
  type InstalledSkill,
} from "../core/install/destination.ts";
import { legacyLayoutPresent } from "../core/install/migrate.ts";
import { tildify, type Scope } from "../core/paths.ts";
import { CRITICAL_EXIT, criticalRules, type Finding } from "../core/scan/index.ts";
import { integrityOf } from "../core/skill/integrity.ts";
import { minReleaseAge, unixNow, type Cooldown } from "../core/source/release-age.ts";
import { policyViolations, type PolicyViolation } from "../core/policy.ts";
import { readProjectConfig, type ProjectPolicy } from "../core/project-config.ts";
import { displayLabel, shortId } from "../core/source/revision.ts";
import {
  describeSelector,
  parseSourceSelector,
  selectsSource,
  type SourceSelector,
} from "../core/source/selector.ts";
import { resolveScope, scopeFlag, type ScopeOptions } from "../core/install/scope.ts";
import {
  computeVerdicts,
  holdsBack,
  requestedNames,
  selectUpdates,
  type MovedVerdict,
  type UpdatableVerdict,
  type UpdateVerdict,
} from "../core/source/upstream.ts";
import {
  recordVerdicts,
  renderUpdateReport,
  type ReportedChange,
  type UpdateReport,
} from "../core/update-report.ts";
import { usageError } from "../core/usage.ts";
import { checkExitCode, checkedSkill } from "../core/verdicts.ts";
import { readOtherScopeLock, reportUpdateDeps, type UpdatedFiles } from "../ui/deps.ts";
import { land } from "../ui/flow.ts";
import { confirmWrite, reviewSkills, type ReviewOptions } from "../ui/gate.ts";
import type { CommandHelp } from "../ui/help.ts";
import { migrateIfLegacy } from "../ui/migrate.ts";
import { colorStat, escapeControl } from "../ui/pager.ts";
import { pickUpdates } from "../ui/pick.ts";
import { fail, withSpinner } from "../ui/prompt.ts";
import { logError, logSkillError, logSourceCaution, logWarn, warn } from "../ui/report.ts";
import {
  describeUpdate,
  emptyScopeMessage,
  logSourceBlocked,
  reportDisabled,
  reportModified,
  reportVerdicts,
  reportWaiting,
  revisionRange,
} from "../ui/status.ts";
import { dim, skillName } from "../ui/style.ts";

export const help: CommandHelp = {
  description:
    "Check upstream, review changes, and update selected skills. Name pinned skills to update them. --check only shows which skills have updates: it never asks, installs and records nothing, and exits 1 when a skill is not up to date.",
  examples: [
    "$ nik update",
    "$ nik update --check",
    "$ nik update --check --json",
    "$ nik up grilling prototype",
    "$ nik update --all -y",
    "$ nik update --source local -y",
    "$ nik update --all -y --min-release-age 7",
    "$ nik update -g",
  ],
};

interface UpdateOptions extends ScopeOptions, ReviewOptions {
  all?: boolean;
  report?: unknown;
  source?: unknown;
  minReleaseAge?: unknown;
  check?: boolean;
  json?: boolean;
}

interface Selection {
  names: string[];
  source: SourceSelector | undefined;
  all: boolean;
  cooldown: Cooldown;
  policy: ProjectPolicy | undefined;
}

export const run = async (names: string[], options: UpdateOptions): Promise<void> => {
  if (options.check) return runCheck(names, options);
  if (options.json) throw usageError("Pass --check with --json.");
  const source = sourceSelector(options.source, names);
  const reportPath = await reportTarget(options.report);
  p.intro("nik update");
  const scope = resolveScope(options, p.log.warn) ?? "project";
  const { minimumReleaseAge, policy } = await readProjectConfig(scope);
  const days = minReleaseAge(options.minReleaseAge, minimumReleaseAge);
  await migrateIfLegacy(scope);
  const report: UpdateReport = {
    scope,
    updated: [],
    blocked: [],
    skipped: [],
    upToDate: [],
    sourceBlocked: [],
  };
  const selection = {
    names,
    source,
    all: source !== undefined || (options.all ?? false),
    cooldown: { days, now: unixNow() },
    policy,
  };
  const outro = await updateScope(selection, { ...options, denyWarn: policy?.denyWarn }, report);
  if (reportPath) await writeReport(reportPath, report);
  p.outro(outro);
};

const writeReport = async (path: string, report: UpdateReport): Promise<void> => {
  try {
    await writeFile(path, renderUpdateReport(report));
    p.log.info(`Wrote ${tildify(path)}`);
  } catch (cause) {
    logError(`Could not write the report: ${(cause as Error).message}`);
    if (!process.exitCode) process.exitCode = 1;
  }
};

const singleValue = (value: unknown, flag: string): string | undefined => {
  if (value === undefined) return undefined;
  // cac parses a numeric value as a number and a repeated option as an array.
  if (typeof value !== "string" && typeof value !== "number") {
    throw usageError(`Pass ${flag} once.`);
  }
  return String(value);
};

const sourceSelector = (value: unknown, names: string[]): SourceSelector | undefined => {
  const raw = singleValue(value, "--source");
  if (raw === undefined) return undefined;
  if (names.length > 0) throw usageError("Pass skill names or --source, not both.");
  return parseSourceSelector(raw);
};

const fromSource = (lock: Lockfile, source: SourceSelector | undefined): Lockfile => {
  if (!source) return lock;
  const skills = Object.fromEntries(
    Object.entries(lock.skills).filter(([, entry]) => selectsSource(source, entry)),
  );
  if (Object.keys(skills).length === 0) {
    fail(`No recorded skill comes from ${describeSelector(source)}.`);
  }
  return { ...lock, skills };
};

const reportTarget = async (value: unknown): Promise<string | undefined> => {
  const raw = singleValue(value, "--report");
  if (raw === undefined) return undefined;
  if (raw === "") throw usageError("Pass a file to --report.");
  const path = resolve(raw);
  if (!(await stat(dirname(path)).catch(() => null))?.isDirectory()) {
    throw usageError(`Report directory not found: ${tildify(dirname(path))}`);
  }
  if ((await stat(path).catch(() => null))?.isDirectory()) {
    throw usageError(`Pass a file to --report, not a directory: ${tildify(path)}`);
  }
  return path;
};

const updateScope = async (
  selection: Selection,
  options: UpdateOptions,
  report: UpdateReport,
): Promise<string> => {
  const { names, all, cooldown } = selection;
  const { scope } = report;
  const loaded = await loadLock(scope);
  const scoped = fromSource(loaded.lock, selection.source);
  if (Object.keys(scoped.skills).length === 0) return emptyScopeMessage(scope);
  const skills = checkedSkills(scoped, selection, report);
  if (skills.length === 0) return "Nothing to update.";

  const modified = await modifiedSkills(skills, scope);
  if (modified.size > 0) {
    reportModified(
      [...modified],
      `Updating one discards its edits. Run ${dim(`nik install${scopeFlag(scope)}`)} to restore it instead.`,
    );
  }

  const verdicts = await withSpinner(
    `Checking upstream for ${skills.length} skill(s)`,
    () => computeVerdicts(skills, names, cooldown),
    () => "Checked upstream sources",
  );
  recordVerdicts(report, verdicts);
  const requested = requestedNames(skills, names, all) ?? [];
  const { moved, outdated, upToDate } = reportVerdicts(verdicts, requested, scope);
  const candidates: UpdatableVerdict[] = [...moved, ...outdated];
  if (candidates.length === 0) return "Nothing to update.";

  const selected = await chooseUpdates(candidates, names, all, upToDate, report);
  if (selected.length === 0) return "Nothing selected.";
  if (selected.some((verdict) => verdict.kind === "outdated")) logSourceCaution();
  const prepared = await previewAndReview(selected, scope, options, report);
  if (prepared.length === 0) return "Nothing selected.";
  return writeUpdates(prepared, loaded, options, report);
};

const checkedSkills = (
  scoped: Lockfile,
  { names, policy }: Selection,
  report: UpdateReport,
): InstalledSkill[] => {
  const { scope } = report;
  const { enabled, disabled } = splitDisabled(scoped);
  const skills = installedSkills(enabled);
  const disabledNames = Object.keys(disabled.skills).toSorted();
  refuseDisabled(names, disabledNames, scope);
  reportDisabled(disabledNames, scope);
  report.skipped.push(...disabledNames.map((name) => ({ kind: "disabled" as const, name })));
  if (skills.length === 0) return [];
  refuseUnknown(names, skills);
  return blockSources(skills, policy, report);
};

const blockSources = (
  skills: InstalledSkill[],
  policy: ProjectPolicy | undefined,
  report: UpdateReport,
): InstalledSkill[] => {
  const violations = policyViolations(policy, skills);
  if (violations.length === 0) return skills;
  for (const violation of violations) logSourceBlocked(violation);
  process.exitCode = CRITICAL_EXIT;
  const blocked = new Set(violations.map(({ name }) => name));
  for (const { name, source } of skills) {
    if (blocked.has(name)) report.sourceBlocked.push({ name, source });
  }
  return skills.filter(({ name }) => !blocked.has(name));
};

const refuseDisabled = (names: string[], disabledNames: string[], scope: Scope): void => {
  const named = names.filter((name) => disabledNames.includes(name));
  if (named.length === 0) return;
  fail(
    `${named.map((name) => `${skillName(name)}: disabled`).join("\n")}\nRun \`nik enable ${named.join(" ")}${scopeFlag(scope)}\` first.`,
  );
};

const refuseUnknown = (names: string[], skills: InstalledSkill[]): void => {
  const unknown = names.filter((name) => !skills.some((skill) => skill.name === name));
  if (unknown.length === 0) return;
  fail(
    `Not installed: ${unknown.join(", ")}\nInstalled: ${skills.map((skill) => skillName(skill.name)).join(", ")}`,
  );
};

const chooseUpdates = async (
  candidates: UpdatableVerdict[],
  names: string[],
  all: boolean,
  upToDate: string[],
  report: UpdateReport,
): Promise<UpdatableVerdict[]> => {
  const selection = selectUpdates(candidates, names, all);
  for (const name of selection.skipped.filter((skipped) => upToDate.includes(skipped))) {
    p.log.info(`${skillName(name)}: up to date`);
  }

  let selected = selection.selected;
  if (selection.needsPrompt) {
    const picked = await pickUpdates(candidates);
    selected = selectUpdates(candidates, picked, false).selected;
  }
  const selectedNames = new Set(selected.map((verdict) => verdict.skill.name));
  for (const verdict of candidates) {
    if (selectedNames.has(verdict.skill.name)) continue;
    if (holdsBack(verdict, names)) recordWaiting(verdict, report);
    else {
      p.log.info(`${skillName(verdict.skill.name)}: update available, not selected`);
      report.skipped.push({ kind: "not-selected", name: verdict.skill.name });
    }
  }
  return selected;
};

const recordWaiting = (verdict: UpdatableVerdict, report: UpdateReport): void => {
  reportWaiting(verdict, report.scope);
  report.skipped.push({
    kind: "waiting",
    name: verdict.skill.name,
    to: verdict.upstream,
    age: verdict.age ?? 0,
  });
};

const writeUpdates = async (
  prepared: UpdateAction[],
  loaded: LoadedLockfile,
  options: UpdateOptions,
  report: UpdateReport,
): Promise<string> => {
  const { scope } = loaded;
  const approved = prepared.flatMap((item) => (item.kind === "update" ? [item.updated] : []));
  await reportUpdateDeps(approved, loaded.lock, await readOtherScopeLock(scope), scope);

  const proceed = await confirmWrite(
    `Update ${prepared.map((item) => skillName(updateName(item))).join(", ")} (${scope})?`,
    approved.map(({ verdict, files, diff }) => ({ name: verdict.skill.name, files, diff })),
    { yes: options.yes, command: "update" },
  );
  if (!proceed) {
    report.skipped.push(
      ...prepared.map((item) => ({ kind: "not-confirmed" as const, name: updateName(item) })),
    );
    return "Nothing selected.";
  }

  const destinationOf = (skill: InstalledSkill): Promise<Destination> =>
    destinationFor(skill, scope, loaded.lock);
  const updated = await landUpdates(prepared, destinationOf, loaded, report);
  return `Updated ${updated} skill(s). Scope: ${scope}.`;
};

type DestinationOf = (skill: InstalledSkill) => Promise<Destination>;

const destinationFor = async (
  skill: InstalledSkill,
  scope: Scope,
  lock: Lockfile,
): Promise<Destination> => {
  const { destination, defaulted } = await updateDestination(skill, scope, lock);
  if (defaulted && destination.kind === "link") {
    warn(`${skillName(skill.name)}: missing. Linking to ${destination.agents.join(", ")}.`);
  }
  return destination;
};

type UpdateAction =
  | { kind: "moved"; verdict: MovedVerdict }
  | { kind: "update"; updated: UpdatedFiles; findings: Finding[] };

const updateName = (item: UpdateAction): string =>
  item.kind === "moved" ? item.verdict.skill.name : item.updated.verdict.skill.name;

const reportedChange = (item: UpdateAction, integrity: string): ReportedChange => {
  if (item.kind === "moved") {
    const { skill, upstream } = item.verdict;
    return { name: skill.name, from: skill, to: { ...upstream, integrity }, findings: [] };
  }
  return changeOf(item.updated, item.findings, integrity);
};

const changeOf = (
  { verdict, diff }: UpdatedFiles,
  findings: Finding[],
  integrity: string,
): ReportedChange => ({
  name: verdict.skill.name,
  from: verdict.skill,
  to: { ...verdict.upstream, integrity },
  stat: diff.stat,
  findings,
});

const landUpdates = (
  items: UpdateAction[],
  destinationOf: DestinationOf,
  loaded: LoadedLockfile,
  report: UpdateReport,
): Promise<number> =>
  land({
    items,
    name: updateName,
    apply: async (item) => {
      const applied =
        item.kind === "moved"
          ? await recordMoved(item.verdict, destinationOf)
          : await applyUpdate(item, destinationOf);
      report.updated.push(reportedChange(item, applied.integrity));
      return applied;
    },
    onError: (item, error) => {
      logSkillError(updateName(item), error);
      report.skipped.push({
        kind: "failed",
        name: updateName(item),
        error: error instanceof Error ? error.message : String(error),
      });
    },
    spinner: (item) =>
      item.kind === "moved"
        ? `Recording ${skillName(item.verdict.skill.name)} at ${displayLabel(item.verdict.upstream)}`
        : null,
    scope: loaded.scope,
    lock: loaded,
  });

const recordMoved = async (
  verdict: MovedVerdict,
  destinationOf: DestinationOf,
): Promise<Applied & { success: string }> => {
  const { skill } = verdict;
  const destination = await destinationOf(skill);
  const result = await applySkill(
    {
      name: skill.name,
      source: skill.source,
      path: skill.path,
      root: skill.root,
      revision: verdict.upstream,
      files: () => verdict.source.fetchFiles(verdict.upstream.commit, skill.path),
    },
    destination,
  );
  return {
    ...result,
    success: `${displayLabel(skill)} → ${displayLabel(verdict.upstream)}. No file changes.`,
  };
};

const previewAndReview = async (
  selected: UpdatableVerdict[],
  scope: Scope,
  options: ReviewOptions,
  report: UpdateReport,
): Promise<UpdateAction[]> => {
  const pending: UpdatedFiles[] = [];
  for (const verdict of selected) {
    const { skill } = verdict;
    const to = verdict.upstream.commit;
    const ids = to ? `: ${shortId(skill)} → ${shortId(verdict.upstream)}` : "";
    if (verdict.kind === "moved") {
      p.note("no file changes", `${skillName(skill.name)}${ids}`);
      continue;
    }
    const { diff, files } = await withSpinner(
      `Reading ${skillName(skill.name)}`,
      async () => ({
        diff: await verdict.source.changes(skill, to, await installedPath(skill, scope)),
        files: await verdict.source.fetchFiles(to, skill.path),
      }),
      (read) => `${skillName(skill.name)}: read ${read.files.length} file(s)`,
    );
    p.note(colorStat(escapeControl(diff.stat)), `${skillName(skill.name)}${ids}`);
    pending.push({ verdict, files, diff });
  }
  if (pending.length === 0) {
    return selected.flatMap((verdict) =>
      verdict.kind === "moved" ? [{ kind: "moved", verdict }] : [],
    );
  }
  const review = await reviewSkills(
    pending.map(({ verdict, files, diff }) => ({ name: verdict.skill.name, files, diff, verdict })),
    options,
  );
  const findingsOf = (name: string): Finding[] => review.findings.get(name) ?? [];
  recordReview(review, findingsOf, report);
  const approved = new Map(
    review.approved.map(({ verdict, files, diff }) => [
      verdict.skill.name,
      { verdict, files, diff },
    ]),
  );
  return selected.flatMap((verdict): UpdateAction[] => {
    if (verdict.kind === "moved") return [{ kind: "moved", verdict }];
    const updated = approved.get(verdict.skill.name);
    return updated ? [{ kind: "update", updated, findings: findingsOf(verdict.skill.name) }] : [];
  });
};

const recordReview = (
  review: { declined: { name: string }[]; blocked: UpdatedFiles[] },
  findingsOf: (name: string) => Finding[],
  report: UpdateReport,
): void => {
  for (const { name } of review.declined) report.skipped.push({ kind: "declined", name });
  for (const blocked of review.blocked) {
    const { verdict, files } = blocked;
    report.blocked.push(changeOf(blocked, findingsOf(verdict.skill.name), integrityOf(files)));
  }
};

const applyUpdate = async (
  { updated: { verdict, files }, findings }: Extract<UpdateAction, { kind: "update" }>,
  destinationOf: DestinationOf,
): Promise<Applied & { success: string }> => {
  const { skill } = verdict;
  const applied = await applySkill(
    {
      name: skill.name,
      source: skill.source,
      path: skill.path,
      root: skill.root,
      revision: verdict.upstream,
      files: () => Promise.resolve(files),
      acceptedRules: criticalRules(findings),
    },
    await destinationOf(skill),
  );
  const range =
    revisionRange(verdict) ||
    `${displayLabel(skill)} → ${displayLabel({ ...verdict.upstream, integrity: applied.integrity })}`;
  return { ...applied, success: `updated ${range}` };
};

const CHECK_CONFLICTS = [
  ["all", "--all"],
  ["source", "--source"],
  ["yes", "--yes"],
  ["dangerousSkipCriticalApproval", "--dangerous-skip-critical-approval"],
  ["report", "--report"],
  ["minReleaseAge", "--min-release-age"],
] as const;

const refuseCheckConflicts = (names: string[], options: UpdateOptions): void => {
  if (names.length > 0) throw usageError("Do not combine --check with skill names.");
  const conflict = CHECK_CONFLICTS.find(([key]) => options[key] !== undefined);
  if (conflict) throw usageError(`Do not combine --check with ${conflict[1]}.`);
};

interface CheckTarget {
  scope: Scope;
  loaded: LoadedLockfile;
  skills: InstalledSkill[];
  disabled: string[];
  blocked: PolicyViolation[];
}

const byName = (a: { name: string }, b: { name: string }): number =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

const checkTarget = async (
  options: UpdateOptions,
  scopeWarning: (message: string) => void,
): Promise<CheckTarget> => {
  const scope = resolveScope(options, scopeWarning) ?? "project";
  // The check writes nothing, so it stops instead of moving files, as audit does.
  if (legacyLayoutPresent(scope)) {
    throw new Error(
      `found files from ski 0.2. Run \`nik list${scopeFlag(scope)}\` once to move them, then check again.`,
    );
  }
  const { policy } = await readProjectConfig(scope);
  const loaded = await loadLock(scope);
  const { enabled, disabled } = splitDisabled(loaded.lock);
  const installed = installedSkills(enabled);
  const blocked = policyViolations(policy, installed);
  const names = new Set(blocked.map(({ name }) => name));
  return {
    scope,
    loaded,
    skills: installed.filter(({ name }) => !names.has(name)).toSorted(byName),
    disabled: Object.keys(disabled.skills).toSorted(),
    blocked,
  };
};

// ssh fails instead of asking for a host key or a passphrase, so a check never waits on a prompt.
const checkVerdicts = (skills: InstalledSkill[]): Promise<UpdateVerdict[]> =>
  computeVerdicts(skills, [], { days: 0, now: unixNow() }, { sshBatch: true });

const runCheck = async (names: string[], options: UpdateOptions): Promise<void> => {
  refuseCheckConflicts(names, options);
  if (options.json) return runCheckJson(options);

  // Nothing reaches stdout until the lockfile loads, so a fatal error leaves stdout empty.
  const warnings: string[] = [];
  const { scope, skills, ...target } = await checkTarget(options, (message) => {
    warnings.push(message);
  });
  const empty = Object.keys(target.loaded.lock.skills).length === 0;
  const emptyMessage = empty ? await emptyScopeMessage(scope) : "";
  p.intro("nik update --check");
  for (const message of warnings) p.log.warn(message);
  if (empty) {
    p.outro(emptyMessage);
    return;
  }
  reportDisabled(target.disabled, scope);
  for (const violation of target.blocked) logSourceBlocked(violation);
  const verdicts =
    skills.length === 0
      ? []
      : await withSpinner(
          `Checking upstream for ${skills.length} skill(s)`,
          () => checkVerdicts(skills),
          () => "Checked upstream sources",
        );
  process.exitCode = checkExitCode(verdicts, target.blocked.length);
  p.outro(reportCheck(verdicts, scope));
};

const reportCheck = (verdicts: UpdateVerdict[], scope: Scope): string => {
  reportVerdicts(verdicts, [], scope);
  const updatable = verdicts.filter(
    (verdict): verdict is UpdatableVerdict =>
      verdict.kind === "moved" || verdict.kind === "outdated",
  );
  for (const verdict of updatable) {
    p.log.info(`${skillName(verdict.skill.name)}: ${describeUpdate(verdict)}`);
  }
  if (updatable.length > 0) {
    p.log.info(`Run ${dim(`nik update${scopeFlag(scope)}`)} to choose which updates to install.`);
  }
  return checkSummary(verdicts, scope);
};

const checkSummary = (verdicts: UpdateVerdict[], scope: Scope): string => {
  const counts = Map.groupBy(verdicts, ({ kind }) => kind.replaceAll("-", " "));
  const notes = [...counts].map(([verdict, group]) => `${group.length} ${verdict}`);
  const checked = `${verdicts.length} skill(s) checked (${scope})`;
  return notes.length > 0 ? `${checked}: ${notes.join(", ")}.` : `${checked}.`;
};

const runCheckJson = async (options: UpdateOptions): Promise<void> => {
  const { scope, skills, ...target } = await checkTarget(options, logWarn);
  for (const violation of target.blocked) logSourceBlocked(violation);
  const verdicts = await checkVerdicts(skills);
  process.exitCode = checkExitCode(verdicts, target.blocked.length);
  console.log(
    JSON.stringify(
      {
        scope,
        lockfile: target.loaded.file,
        skills: verdicts.map(checkedSkill),
        disabled: target.disabled,
        blocked: target.blocked.map(({ name }) => name),
      },
      null,
      2,
    ),
  );
};
