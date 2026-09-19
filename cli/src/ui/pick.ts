import * as p from "@clack/prompts";
import { basename } from "node:path";
import type { AgentId } from "../core/install/agents.ts";
import { selector, type DiscoveredSkill } from "../core/source/discover.ts";
import { occupiedAgents } from "../core/install/link.ts";
import {
  lackingAgents,
  locationDisplayPath,
  locationPresent,
  type Location,
} from "../core/install/destination.ts";
import { nearest } from "../core/suggest.ts";
import { isApproved, type LockEntry, type Lockfile } from "../core/install/lockfile.ts";
import { integrityOf } from "../core/skill/integrity.ts";
import type { Scope } from "../core/paths.ts";
import { scopeFlag } from "../core/install/scope.ts";
import { parseCoordinate, type Coordinate } from "../core/source/coordinate.ts";
import { sourceMatches, type Source } from "../core/source/index.ts";
import { displayLabel, type Revision } from "../core/source/revision.ts";
import type { OutdatedVerdict } from "../core/source/upstream.ts";
import { usageError, USAGE_ERROR } from "../core/usage.ts";
import { fail, requireTTY, unwrap, withSpinner } from "./prompt.ts";
import { describeOutdated, friendlySource, groupLabel } from "./status.ts";
import { green, skillName, softOrange, summarize, unstruck } from "./style.ts";

const COORDINATE_REMEDY = "Pass skill names, owner/repo/skill, or --all.";
const SELECTION_REMEDY = "Pass skill names or --all.";

interface SelectOption {
  value: string;
  label: string;
}

const groupOptionsBySource = <T>(
  items: T[],
  sourceOf: (item: T) => string,
  labelOf: (source: string, items: T[]) => string,
  optionOf: (item: T) => SelectOption,
): Record<string, SelectOption[]> => {
  const groups: Record<string, SelectOption[]> = {};
  for (const [source, rows] of Map.groupBy(items, sourceOf)) {
    groups[labelOf(source, rows)] = rows.map(optionOf);
  }
  return groups;
};

const matching = (skills: DiscoveredSkill[], given: string): DiscoveredSkill[] => {
  const byPath = skills.filter((skill) => skill.path === given);
  if (byPath.length > 0) return byPath;
  const name = basename(given);
  return skills.filter((skill) => !skill.ambiguous && skill.name === name);
};

const requireKnown = (source: string, names: string[], skills: DiscoveredSkill[]): void => {
  const unknown = names.filter((name) => matching(skills, name).length === 0);
  if (unknown.length === 0) return;

  const shared = [
    ...new Set(
      unknown
        .map((name) => basename(name))
        .filter((name) => skills.some((skill) => skill.ambiguous && skill.name === name)),
    ),
  ];
  if (shared.length > 0) {
    const paths = skills
      .filter((skill) => skill.ambiguous && shared.includes(skill.name))
      .map((skill) => skill.path);
    fail(
      `${shared.join(", ")} has more than one match. Pass a path:\n${paths.map((path) => `  ${path}`).join("\n")}`,
    );
  }

  const selectors = skills.map(selector);
  const guesses = [
    ...new Set(
      unknown.map((name) => nearest(name, selectors)).filter((guess) => guess !== undefined),
    ),
  ];
  fail(
    `${friendlySource(source)} has no skill${unknown.length === 1 ? "" : "s"} called ${unknown.join(", ")}.\n` +
      (guesses.length > 0
        ? `Did you mean ${guesses.map(skillName).join(", ")}?`
        : `Skills: ${selectors.map(skillName).join(", ")}`),
  );
};

const requireDistinct = (picked: DiscoveredSkill[]): void => {
  for (const [name, group] of Map.groupBy(picked, (skill) => skill.name)) {
    if (group.length > 1) {
      fail(
        `Cannot install two skills named ${name}: ${group.map((skill) => skill.path).join(" and ")}.\nPick one.`,
      );
    }
  }
};

export interface PickerRow {
  skill: DiscoveredSkill;
  held?: boolean;
  why?: string;
  mark?: string;
}

const HELD_GLYPH = p.unicodeOr("✓", "*");

const plainName = (skill: DiscoveredSkill): string =>
  skill.ambiguous ? `${skill.name}  ${skill.path}` : skill.name;

const coloredName = (skill: DiscoveredSkill): string =>
  skill.ambiguous ? `${skillName(skill.name)}  ${skill.path}` : skillName(skill.name);

const unmanagedMark = (
  skill: DiscoveredSkill,
  scope: Scope,
  agents: AgentId[],
): string | undefined => {
  const where = occupiedAgents(skill.name, scope).filter((agent) => agents.includes(agent));
  return where.length === 0 ? undefined : `unmanaged in ${where.join(", ")}`;
};

const offerableRow = (skill: DiscoveredSkill, scope: Scope, agents: AgentId[]): PickerRow => {
  const row: PickerRow = { skill };
  const mark = unmanagedMark(skill, scope, agents);
  if (mark !== undefined) row.mark = mark;
  return row;
};

export const skillOption = (
  row: PickerRow,
): { value: string; label: string; hint?: string; disabled?: boolean } => {
  const hint =
    row.why ?? row.mark ?? (row.held === true ? undefined : summarize(row.skill.description));
  const name = row.held === true ? plainName(row.skill) : coloredName(row.skill);
  const glyph =
    row.held === true
      ? unstruck(`  ${green(HELD_GLYPH)}`)
      : row.mark === undefined
        ? ""
        : `  ${softOrange(p.S_WARN)}`;
  return {
    value: selector(row.skill),
    label: `${name}${glyph}`,
    ...(hint !== undefined ? { hint } : {}),
    ...(row.held === true ? { disabled: true } : {}),
  };
};

const pickFrom = async (
  message: string,
  source: string,
  offered: PickerRow[],
): Promise<DiscoveredSkill[]> => {
  requireTTY("nik add needs to know which skills", COORDINATE_REMEDY);
  const picked = new Set(
    unwrap(
      await p.multiselect<string>({
        message: `${message} from ${friendlySource(source)}. ${offered.length} skill(s).`,
        options: offered.map(skillOption),
        required: false,
      }),
    ),
  );
  const chosen = offered.filter((row) => picked.has(selector(row.skill))).map((row) => row.skill);
  requireDistinct(chosen);
  return chosen;
};

const listHeld = (held: PickerRow[], skipped: (row: PickerRow) => string): void => {
  for (const row of held) {
    p.log.info(`${skillName(row.skill.name)}: ${row.why ?? skipped(row)}`);
  }
};

export interface Extension {
  skill: DiscoveredSkill;
  agents: AgentId[];
}

interface Picked {
  skills: DiscoveredSkill[];
  extend: Extension[];
  asked: boolean;
}

interface AddSelection {
  skills: DiscoveredSkill[];
  names: string[];
  lock: Lockfile;
  scope: Scope;
  agents: AgentId[];
  source: Source;
  rev: Revision;
  options: { all?: boolean | undefined; copy: boolean; copyPath?: string | undefined };
}

interface Held {
  why: string;
  command: "nik remove" | "nik enable";
}

const approvedMissingAgentsByPath = async (
  selection: AddSelection,
  held: (skill: DiscoveredSkill) => Held | undefined,
): Promise<Map<string, AgentId[]>> => {
  const { skills, lock, scope, agents, source, rev } = selection;
  const candidates = skills.filter((skill) => {
    const entry = lock.skills[skill.name];
    return entry !== undefined && entry.source === source.id && entry.path === skill.path;
  });
  if (candidates.length === 0) return new Map();
  const pairs = await withSpinner(
    `Checking ${candidates.length} installed skill(s) against ${source.display}`,
    () =>
      Promise.all(
        candidates.map(async (skill): Promise<[DiscoveredSkill, string]> => [
          skill,
          integrityOf(await source.fetchFiles(rev.commit, skill.path)),
        ]),
      ),
    (checked) => `Checked ${checked.length} installed skill(s)`,
  );
  const lacking = new Map<string, AgentId[]>();
  for (const [skill, integrity] of pairs) {
    if (held(skill) !== undefined) continue;
    if (!isApproved(lock, skill.name, { source: source.id, path: skill.path, integrity })) {
      continue;
    }
    const entry = lock.skills[skill.name]!;
    lacking.set(skill.path, await lackingAgents({ name: skill.name, ...entry }, scope, agents));
  }
  return lacking;
};

const extendRow = (skill: DiscoveredSkill, scope: Scope, missing: AgentId[]): PickerRow => {
  const mark = unmanagedMark(skill, scope, missing);
  return mark === undefined ? { skill, why: `not in ${missing.join(", ")}` } : { skill, mark };
};

export const pickSkillsToAdd = async (selection: AddSelection): Promise<Picked> => {
  const { skills, names, lock, scope, agents, source, options } = selection;
  const held = (skill: DiscoveredSkill): Held | undefined => {
    const entry = lock.skills[skill.name];
    if (entry === undefined) return undefined;
    const command = "nik remove";
    if (entry.source !== source.id) {
      return { why: `installed from ${friendlySource(entry.source)}`, command };
    }
    if (entry.disabled) return { why: "disabled", command: "nik enable" };
    if ((entry.copy === true) !== options.copy) {
      return { why: `installed as a ${entry.copy ? "copy" : "link"}`, command };
    }
    if (entry.copyPath !== options.copyPath) {
      return {
        why: entry.copyPath
          ? `installed as a path copy at ${entry.copyPath}`
          : "installed as an agent copy",
        command,
      };
    }
    return undefined;
  };
  const failHeld = (skill: DiscoveredSkill, { why, command }: Held): never =>
    fail(
      `${skill.name} is already ${why}.\nRun \`${command} ${skill.name}${scopeFlag(scope)}\` first.`,
    );
  const lacking = await approvedMissingAgentsByPath(selection, held);
  const complete = (skill: DiscoveredSkill): boolean => lacking.get(skill.path)?.length === 0;
  const alreadyIn = options.copyPath
    ? `already at ${options.copyPath}, skipped`
    : `already in ${agents.join(", ")}, skipped`;
  const skipComplete = (skill: DiscoveredSkill): void =>
    p.log.info(`${skillName(skill.name)}: ${alreadyIn}`);
  const split = (chosen: DiscoveredSkill[], asked: boolean): Picked => {
    const picked: Picked = { skills: [], extend: [], asked };
    for (const skill of chosen) {
      const missing = lacking.get(skill.path);
      if (missing === undefined) picked.skills.push(skill);
      else if (missing.length > 0) picked.extend.push({ skill, agents: missing });
    }
    return picked;
  };

  if (names.length > 0) {
    requireKnown(source.id, names, skills);
    const requested = [...new Set(names.flatMap((name) => matching(skills, name)))];
    requireDistinct(requested);
    for (const skill of requested) {
      const why = held(skill);
      if (why) failHeld(skill, why);
    }
    for (const skill of requested.filter(complete)) skipComplete(skill);
    return split(requested, false);
  }

  if (options.all) {
    const offered = skills.filter((skill) => held(skill) === undefined);
    requireDistinct(offered);
    return split(offered, false);
  }

  if (skills.length === 1) {
    const only = skills[0]!;
    const why = held(only);
    if (why) failHeld(only, why);
    if (complete(only)) skipComplete(only);
    return split([only], false);
  }

  const rows = skills.map((skill): PickerRow => {
    if (lock.skills[skill.name] === undefined) return offerableRow(skill, scope, agents);
    const reason = held(skill);
    if (reason) return { skill, held: true, why: `${reason.why}, use ${reason.command}` };
    const missing = lacking.get(skill.path);
    if (missing === undefined || missing.length === 0) return { skill, held: true };
    return extendRow(skill, scope, missing);
  });
  if (rows.every((row) => row.held === true)) {
    listHeld(rows, (row) =>
      complete(row.skill) ? alreadyIn : "already installed, use nik update",
    );
    return split([], false);
  }

  return split(await pickFrom("Select skills to add", source.id, rows), true);
};

export const pickUpdates = async (updatable: OutdatedVerdict[]): Promise<string[]> => {
  requireTTY("nik update needs to know which skills", SELECTION_REMEDY);
  const groups = groupOptionsBySource(
    updatable,
    (verdict) => verdict.skill.source,
    groupLabel,
    (verdict) => ({
      value: verdict.skill.name,
      label: `${skillName(verdict.skill.name)}: ${describeOutdated(verdict)}`,
    }),
  );
  return unwrap(
    await p.groupMultiselect({
      message: "Select skills to update",
      options: groups,
      required: false,
    }),
  );
};

const stateLabel = (name: string, entry: LockEntry, location: Location): string => {
  if (!locationPresent(location)) return entry.disabled ? "[disabled]" : "[missing]";
  const path = locationDisplayPath(name, location);
  return `[${location.kind === "path-copy" ? `${path} copy` : path}]`;
};

interface RecordedPicker {
  command: string;
  names: string[];
  lock: Lockfile;
  locations: Map<string, Location>;
}

export const pickRecorded = async ({
  command,
  names,
  lock,
  locations,
}: RecordedPicker): Promise<string[]> => {
  requireTTY(`nik ${command} needs to know which skills`, SELECTION_REMEDY);
  const groups = groupOptionsBySource(
    names,
    (name) => friendlySource(lock.skills[name]!.source),
    (source, rows) => `${source} (${rows.length} skill(s))`,
    (name) => {
      const entry = lock.skills[name]!;
      return {
        value: name,
        label: `${skillName(name)}: ${displayLabel(entry)} ${stateLabel(name, entry, locations.get(name)!)}`,
      };
    },
  );
  return unwrap(
    await p.groupMultiselect<string>({
      message: `Select skills to ${command}`,
      options: groups,
      required: false,
    }),
  );
};

const SOURCE_ONLY =
  "Pass the skill name, or the source alone: owner/repo, a Git URL, or a local path.";

const parseSourceOrFail = (raw: string): Coordinate => {
  let parsed: Coordinate;
  try {
    parsed = parseCoordinate(raw);
  } catch (e) {
    if ((e as Error).name === USAGE_ERROR) throw e;
    return fail((e as Error).message);
  }
  if (parsed.skill !== undefined || parsed.ref !== undefined || parsed.tree !== undefined) {
    throw usageError(`${raw} names a skill or ref inside a source.\n${SOURCE_ONLY}`);
  }
  return parsed;
};

const expandSources = (args: string[], lock: Lockfile, recorded: string[]): string[] => {
  const names: string[] = [];
  const unknown: string[] = [];
  for (const arg of args) {
    if (!arg.includes("/")) {
      if (!recorded.includes(arg)) unknown.push(arg);
      names.push(arg);
      continue;
    }
    const coordinate = parseSourceOrFail(arg);
    const matched = recorded.filter((name) => sourceMatches(lock.skills[name]!.source, coordinate));
    if (matched.length === 0) unknown.push(arg);
    names.push(...matched);
  }
  if (unknown.length > 0) {
    fail(`Not recorded: ${unknown.join(", ")}\nRecorded: ${recorded.map(skillName).join(", ")}`);
  }
  return [...new Set(names)];
};

const REQUESTED_STATE = { disable: "disabled", enable: "enabled" } as const;

interface RecordedSelection {
  command: keyof typeof REQUESTED_STATE;
  lock: Lockfile;
  locations: Map<string, Location>;
  offered: string[];
  all: boolean | undefined;
}

export const selectRecorded = async (
  args: string[],
  { command, lock, locations, offered, all }: RecordedSelection,
): Promise<{ names: string[]; asked: boolean }> => {
  const recorded = Object.keys(lock.skills).toSorted();
  let requested = expandSources(args, lock, recorded);
  if (requested.length === 0 && all) requested = offered;
  if (requested.length === 0) {
    if (offered.length === 0) return { names: [], asked: false };
    return { names: await pickRecorded({ command, names: offered, lock, locations }), asked: true };
  }
  for (const name of requested) {
    if (!offered.includes(name)) {
      p.log.info(`${skillName(name)}: already ${REQUESTED_STATE[command]}`);
    }
  }
  return { names: requested.filter((name) => offered.includes(name)), asked: false };
};
