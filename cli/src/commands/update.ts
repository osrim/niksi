import * as p from "@clack/prompts";
import { applySkill, type Destination } from "../core/install/apply.ts";
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
import type { Scope } from "../core/paths.ts";
import { displayLabel, shortId } from "../core/source/revision.ts";
import { resolveScope, scopeFlag, type ScopeOptions } from "../core/install/scope.ts";
import {
  computeVerdicts,
  selectUpdates,
  type MovedVerdict,
  type UpdatableVerdict,
} from "../core/source/upstream.ts";
import { reportUpdateDeps, type UpdatedFiles } from "../ui/deps.ts";
import { confirm, land } from "../ui/flow.ts";
import { reviewSkills, type ReviewOptions } from "../ui/gate.ts";
import type { CommandHelp } from "../ui/help.ts";
import { migrateIfLegacy } from "../ui/migrate.ts";
import { pickUpdates } from "../ui/pick.ts";
import { fail, withSpinner } from "../ui/prompt.ts";
import { logSourceCaution, warn } from "../ui/report.ts";
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
}

const DIFF_PREVIEW_LINES = 120;

export const run = async (names: string[], options: UpdateOptions): Promise<void> => {
  p.intro("nik update");
  const scope = resolveScope(options, p.log.warn) ?? "project";
  await migrateIfLegacy(scope);

  const loaded = await loadLock(scope);
  const { enabled, disabled } = splitDisabled(loaded.lock);
  const skills = installedSkills(enabled);
  const disabledNames = Object.keys(disabled.skills).toSorted();
  if (skills.length === 0 && disabledNames.length === 0) {
    p.outro(await emptyScopeMessage(scope));
    return;
  }
  const namedDisabled = names.filter((name) => disabledNames.includes(name));
  if (namedDisabled.length > 0) {
    fail(
      `${namedDisabled.map((name) => `${skillName(name)}: disabled`).join("\n")}\nRun \`nik enable ${namedDisabled.join(" ")}${scopeFlag(scope)}\` first.`,
    );
  }
  reportDisabled(disabledNames, scope);
  if (skills.length === 0) {
    p.outro("Nothing to update.");
    return;
  }

  const unknown = names.filter((name) => !skills.some((skill) => skill.name === name));
  if (unknown.length > 0) {
    fail(
      `Not installed: ${unknown.join(", ")}\nInstalled: ${skills.map((skill) => skillName(skill.name)).join(", ")}`,
    );
  }

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
  const { moved, outdated } = reportVerdicts(verdicts, names, scope);
  const candidates: UpdatableVerdict[] = [...moved, ...outdated];

  const destinationOf = (skill: InstalledSkill): Promise<Destination> =>
    destinationFor(skill, scope, loaded.lock);

  if (candidates.length === 0) {
    p.outro("Nothing to update.");
    return;
  }

  const selection = selectUpdates(candidates, names, options.all ?? false);
  for (const name of selection.skipped) p.log.info(`${skillName(name)}: up to date`);

  let selected = selection.selected;
  if (selection.needsPrompt) {
    const picked = await pickUpdates(candidates);
    selected = selectUpdates(candidates, picked, false).selected;
  }
  const selectedNames = new Set(selected.map((verdict) => verdict.skill.name));
  for (const verdict of candidates) {
    if (!selectedNames.has(verdict.skill.name)) {
      p.log.info(`${skillName(verdict.skill.name)}: update available, not selected`);
    }
  }
  if (selected.length === 0) {
    p.outro("Nothing selected.");
    return;
  }

  if (selected.some((verdict) => verdict.kind === "outdated")) logSourceCaution();
  const prepared = await previewAndReview(selected, scope, options);
  if (prepared.length === 0) {
    p.outro("Nothing selected.");
    return;
  }
  const approved = prepared.flatMap((item) => (item.kind === "update" ? [item.updated] : []));
  await reportUpdateDeps(approved, loaded.lock, scope);

  const proceed = await confirm(
    `Update ${prepared.map((item) => skillName(updateName(item))).join(", ")} (${scope})?`,
    { yes: options.yes, command: "update" },
  );
  if (!proceed) {
    p.outro("Nothing selected.");
    return;
  }

  await landUpdates(prepared, destinationOf, loaded);
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
  | { kind: "update"; updated: UpdatedFiles };

const updateName = (item: UpdateAction): string =>
  item.kind === "moved" ? item.verdict.skill.name : item.updated.verdict.skill.name;

const landUpdates = async (
  items: UpdateAction[],
  destinationOf: DestinationOf,
  loaded: LoadedLockfile,
): Promise<void> => {
  await land({
    items,
    name: updateName,
    apply: (item) =>
      item.kind === "moved"
        ? recordMoved(item.verdict, destinationOf)
        : applyUpdate(item.updated, destinationOf),
    spinner: (item) =>
      item.kind === "moved"
        ? `Recording ${skillName(item.verdict.skill.name)} at ${displayLabel(item.verdict.upstream)}`
        : null,
    scope: loaded.scope,
    lock: loaded,
    outro: (updated) => `Updated ${updated} skill(s). Scope: ${loaded.scope}.`,
  });
};

const recordMoved = async (
  verdict: MovedVerdict,
  destinationOf: DestinationOf,
): Promise<{ integrity: string; restored: boolean; success: string }> => {
  const { skill } = verdict;
  const destination = await destinationOf(skill);
  const result = await applySkill(
    {
      name: skill.name,
      source: skill.source,
      path: skill.path,
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
    const { changes, files } = await withSpinner(
      `Reading ${skillName(skill.name)}`,
      async () => ({
        changes: await verdict.source.changes(skill, to, await installedPath(skill, scope)),
        files: await verdict.source.fetchFiles(to, skill.path),
      }),
      (read) => `${skillName(skill.name)}: read ${read.files.length} file(s)`,
    );
    p.note(truncate(changes.patch), `${skillName(skill.name)}${ids}`);
    pending.push({ verdict, files });
  }
  if (pending.length === 0) {
    return selected.flatMap((verdict) =>
      verdict.kind === "moved" ? [{ kind: "moved", verdict }] : [],
    );
  }
  const review = await reviewSkills(
    pending.map(({ verdict, files }) => ({ name: verdict.skill.name, files, verdict })),
    options,
  );
  const approved = new Map(
    review.approved.map(({ verdict, files }) => [verdict.skill.name, { verdict, files }]),
  );
  return selected.flatMap((verdict): UpdateAction[] => {
    if (verdict.kind === "moved") return [{ kind: "moved", verdict }];
    const updated = approved.get(verdict.skill.name);
    return updated ? [{ kind: "update", updated }] : [];
  });
};

const applyUpdate = async (
  { verdict, files }: UpdatedFiles,
  destinationOf: DestinationOf,
): Promise<{ restored: boolean; success: string }> => {
  const { skill } = verdict;
  const { integrity, restored } = await applySkill(
    {
      name: skill.name,
      source: skill.source,
      path: skill.path,
      revision: verdict.upstream,
      files: () => Promise.resolve(files),
    },
    await destinationOf(skill),
  );
  const range =
    revisionRange(verdict) ||
    `${displayLabel(skill)} → ${displayLabel({ ...verdict.upstream, integrity })}`;
  return { restored, success: `updated ${range}` };
};

const truncate = (diff: string): string => {
  const lines = diff.split("\n");
  if (lines.length <= DIFF_PREVIEW_LINES) return diff.trimEnd();
  const hidden = lines.length - DIFF_PREVIEW_LINES;
  return `${lines.slice(0, DIFF_PREVIEW_LINES).join("\n")}\n… (${hidden} more lines)`;
};
