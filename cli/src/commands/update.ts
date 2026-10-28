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
import { tildify, type Scope } from "../core/paths.ts";
import type { Finding } from "../core/scan/index.ts";
import { integrityOf } from "../core/skill/integrity.ts";
import { displayLabel, shortId } from "../core/source/revision.ts";
import { resolveScope, scopeFlag, type ScopeOptions } from "../core/install/scope.ts";
import {
  computeVerdicts,
  requestedNames,
  selectUpdates,
  type MovedVerdict,
  type UpdatableVerdict,
} from "../core/source/upstream.ts";
import {
  recordVerdicts,
  renderUpdateReport,
  type ReportedChange,
  type UpdateReport,
} from "../core/update-report.ts";
import { usageError } from "../core/usage.ts";
import { readOtherScopeLock, reportUpdateDeps, type UpdatedFiles } from "../ui/deps.ts";
import { land } from "../ui/flow.ts";
import { confirmWrite, reviewSkills, type ReviewOptions } from "../ui/gate.ts";
import type { CommandHelp } from "../ui/help.ts";
import { migrateIfLegacy } from "../ui/migrate.ts";
import { colorStat, escapeControl } from "../ui/pager.ts";
import { pickUpdates } from "../ui/pick.ts";
import { fail, withSpinner } from "../ui/prompt.ts";
import { logError, logSkillError, logSourceCaution, warn } from "../ui/report.ts";
import {
  emptyScopeMessage,
  reportDisabled,
  reportModified,
  reportVerdicts,
  revisionRange,
} from "../ui/status.ts";
import { dim, skillName } from "../ui/style.ts";

export const help: CommandHelp = {
  description:
    "Check upstream, review changes, and update selected skills. Name pinned skills to update them.",
  examples: [
    "$ nik update",
    "$ nik up grilling prototype",
    "$ nik update --all -y",
    "$ nik update -g",
  ],
};

interface UpdateOptions extends ScopeOptions, ReviewOptions {
  all?: boolean;
  report?: unknown;
}

export const run = async (names: string[], options: UpdateOptions): Promise<void> => {
  const reportPath = await reportTarget(options.report);
  p.intro("nik update");
  const scope = resolveScope(options, p.log.warn) ?? "project";
  await migrateIfLegacy(scope);
  const report: UpdateReport = { scope, updated: [], blocked: [], skipped: [], upToDate: [] };
  const outro = await updateScope(names, options, report);
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

const reportTarget = async (value: unknown): Promise<string | undefined> => {
  if (value === undefined) return undefined;
  // cac parses a numeric value as a number and a repeated option as an array.
  if (typeof value !== "string" && typeof value !== "number") {
    throw usageError("Pass --report once.");
  }
  if (value === "") throw usageError("Pass a file to --report.");
  const path = resolve(String(value));
  if (!(await stat(dirname(path)).catch(() => null))?.isDirectory()) {
    throw usageError(`Report directory not found: ${tildify(dirname(path))}`);
  }
  if ((await stat(path).catch(() => null))?.isDirectory()) {
    throw usageError(`Pass a file to --report, not a directory: ${tildify(path)}`);
  }
  return path;
};

const updateScope = async (
  names: string[],
  options: UpdateOptions,
  report: UpdateReport,
): Promise<string> => {
  const { scope } = report;
  const loaded = await loadLock(scope);
  const { enabled, disabled } = splitDisabled(loaded.lock);
  const skills = installedSkills(enabled);
  const disabledNames = Object.keys(disabled.skills).toSorted();
  if (skills.length === 0 && disabledNames.length === 0) return emptyScopeMessage(scope);
  refuseDisabled(names, disabledNames, scope);
  reportDisabled(disabledNames, scope);
  report.skipped.push(...disabledNames.map((name) => ({ kind: "disabled" as const, name })));
  if (skills.length === 0) return "Nothing to update.";
  refuseUnknown(names, skills);

  const modified = await modifiedSkills(skills, scope);
  if (modified.size > 0) {
    reportModified(
      [...modified],
      `Updating one discards its edits. Run ${dim(`nik install${scopeFlag(scope)}`)} to restore it instead.`,
    );
  }

  const verdicts = await withSpinner(
    `Checking upstream for ${skills.length} skill(s)`,
    () => computeVerdicts(skills, names),
    () => "Checked upstream sources",
  );
  recordVerdicts(report, verdicts);
  const requested = requestedNames(skills, names, options.all ?? false) ?? [];
  const { moved, outdated, upToDate } = reportVerdicts(verdicts, requested, scope);
  const candidates: UpdatableVerdict[] = [...moved, ...outdated];
  if (candidates.length === 0) return "Nothing to update.";

  const selected = await chooseUpdates(candidates, names, options.all ?? false, upToDate, report);
  if (selected.length === 0) return "Nothing selected.";
  if (selected.some((verdict) => verdict.kind === "outdated")) logSourceCaution();
  const prepared = await previewAndReview(selected, scope, options, report);
  if (prepared.length === 0) return "Nothing selected.";
  return writeUpdates(prepared, loaded, options, report);
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
    if (!selectedNames.has(verdict.skill.name)) {
      p.log.info(`${skillName(verdict.skill.name)}: update available, not selected`);
      report.skipped.push({ kind: "not-selected", name: verdict.skill.name });
    }
  }
  return selected;
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
          : await applyUpdate(item.updated, destinationOf);
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
  { verdict, files }: UpdatedFiles,
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
    },
    await destinationOf(skill),
  );
  const range =
    revisionRange(verdict) ||
    `${displayLabel(skill)} → ${displayLabel({ ...verdict.upstream, integrity: applied.integrity })}`;
  return { ...applied, success: `updated ${range}` };
};
