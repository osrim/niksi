import * as p from "@clack/prompts";
import { relative } from "node:path";
import { adoptSkill, type AdoptPlan } from "../core/install/adopt.ts";
import { loadLock, type Lockfile } from "../core/install/lockfile.ts";
import { resolveScope, type ScopeOptions } from "../core/install/scope.ts";
import {
  findUnmanaged,
  type SkippedSkill,
  type UnmanagedSkill,
} from "../core/install/unmanaged.ts";
import { tildify, type Scope } from "../core/paths.ts";
import { criticalRules } from "../core/scan/index.ts";
import type { SkillFile } from "../core/skill/files.ts";
import { parseSource } from "../core/source/coordinate.ts";
import { GitSource } from "../core/source/git-source.ts";
import {
  localAnchor,
  sourceForCoordinate,
  type Anchored,
  type Source,
} from "../core/source/index.ts";
import { matchSkill, type Match } from "../core/source/match.ts";
import { ghSkillHint, readSkillsLockHints, type UpstreamHint } from "../core/source/provenance.ts";
import { displayLabel, type Revision } from "../core/source/revision.ts";
import { usageError, USAGE_ERROR } from "../core/usage.ts";
import { land } from "../ui/flow.ts";
import { confirmWrite, reviewSkills, type ReviewOptions } from "../ui/gate.ts";
import type { CommandHelp } from "../ui/help.ts";
import { migrateIfLegacy } from "../ui/migrate.ts";
import { fail, requireTTY, unwrap, withSpinner } from "../ui/prompt.ts";
import { logSkillError, warn } from "../ui/report.ts";
import { friendlySource } from "../ui/status.ts";
import { bold, dim, pad, skillName } from "../ui/style.ts";

export const help: CommandHelp = {
  description:
    "Record skills that are already in agent skills directories, such as skills from gh skill, npx skills, or a manual copy. Each skill is scanned and shown before niksi-lock.json records it. --source <coordinate> matches the skills against one source.",
  examples: [
    "$ nik adopt",
    "$ nik adopt pdf --source anthropics/skills",
    "$ nik adopt --all -g -y",
  ],
};

interface AdoptOptions extends ScopeOptions, ReviewOptions {
  all?: boolean;
  source?: string | string[];
}

interface Resolved {
  skill: UnmanagedSkill;
  source: string;
  path: string;
  root?: string | undefined;
  revision: Revision;
  files: SkillFile[];
  integrity: string;
  matched: boolean;
  note: string;
}

const SOURCE_REMEDY = "Pass the source alone: owner/repo, a Git URL, or a local path.";

const sourceOption = (raw: string | string[] | undefined): Source | undefined => {
  if (raw === undefined) return undefined;
  if (Array.isArray(raw)) throw usageError("Pass --source once.");
  try {
    return sourceForCoordinate(parseSource(raw, SOURCE_REMEDY));
  } catch (e) {
    if ((e as Error).name === USAGE_ERROR) throw e;
    return fail((e as Error).message);
  }
};

export const run = async (names: string[], options: AdoptOptions): Promise<void> => {
  p.intro("nik adopt");
  const scope = resolveScope(options, p.log.warn) ?? "project";
  const from = sourceOption(options.source);
  await migrateIfLegacy(scope);
  const loaded = await loadLock(scope);
  const { skills, skipped } = await findUnmanaged(scope, loaded.lock);
  reportSkipped(skipped, names);
  const { selected, asked } = await selectSkills(
    names,
    { skills, skipped, lock: loaded.lock },
    options,
  );
  if (selected.length === 0) {
    p.outro(asked ? "Nothing selected." : "Nothing to adopt.");
    return;
  }

  const resolved = await resolveAll(selected, scope, from);
  if (resolved.length === 0) {
    p.outro("Nothing adopted.");
    return;
  }
  preview(resolved, loaded.file);
  const review = await reviewSkills(
    resolved.map((item) => ({ name: item.skill.name, files: item.files, item })),
    options,
  );
  if (review.approved.length === 0) {
    p.outro("Nothing selected.");
    return;
  }
  const approved = review.approved.map(({ item, name }) =>
    Object.assign({ acceptedRules: criticalRules(review.findings.get(name) ?? []) }, item),
  );
  const proceed = await confirmWrite(
    `Adopt ${approved.map((item) => skillName(item.skill.name)).join(", ")}?`,
    approved.map((item) => ({ name: item.skill.name, files: item.files })),
    { yes: options.yes, command: "adopt" },
  );
  if (!proceed) {
    p.outro("Nothing selected.");
    return;
  }
  await land({
    items: approved,
    name: (item) => item.skill.name,
    apply: async (item) => {
      await adoptSkill(planOf(item), loaded.lock);
      return {
        success: `adopted @ ${displayLabel({ ...item.revision, integrity: item.integrity })}`,
      };
    },
    scope,
    lock: loaded,
    outro: (adopted) => `Adopted ${adopted} skill(s) (${scope}).`,
  });
};

const upstreamSkillMd = (item: Resolved): { skillMd?: Buffer } => {
  const skillMd = item.files.find((file) => file.path === "SKILL.md");
  return item.matched && skillMd ? { skillMd: skillMd.content } : {};
};

const planOf = (item: Resolved & { acceptedRules: string[] }): AdoptPlan => ({
  name: item.skill.name,
  source: item.source,
  path: item.path,
  root: item.root,
  revision: item.revision,
  integrity: item.integrity,
  agents: item.skill.agents,
  dirs: item.skill.dirs,
  scannedIntegrity: item.skill.integrity,
  ...upstreamSkillMd(item),
  acceptedRules: item.acceptedRules,
});

const shown = (path: string): string => {
  const rel = relative(process.cwd(), path);
  return rel.startsWith("..") ? tildify(path) : rel;
};

const reportSkipped = (skipped: SkippedSkill[], names: string[]): void => {
  for (const { name, reason, paths, target } of skipped) {
    if (names.length > 0 && !names.includes(name)) continue;
    if (reason === "differ") {
      warn(
        `${skillName(name)}: copies differ: ${paths.map(shown).join(", ")}\nKeep one copy, then run \`nik adopt\` again.`,
      );
    } else {
      warn(
        `${skillName(name)}: ${shown(paths[0]!)} links to ${shown(target!)}\nTo record it, delete the link and run \`nik add ${shown(target!)}\`.`,
      );
    }
    if (names.includes(name)) process.exitCode = 1;
  }
};

interface Found {
  skills: UnmanagedSkill[];
  skipped: SkippedSkill[];
  lock: Lockfile;
}

const selectSkills = async (
  names: string[],
  { skills, skipped, lock }: Found,
  options: AdoptOptions,
): Promise<{ selected: UnmanagedSkill[]; asked: boolean }> => {
  if (names.length > 0) {
    for (const name of names) {
      if (lock.skills[name] !== undefined) p.log.info(`${skillName(name)}: already recorded`);
    }
    const known = (name: string): boolean =>
      lock.skills[name] !== undefined ||
      [...skills, ...skipped].some((skill) => skill.name === name);
    const unknown = names.filter((name) => !known(name));
    if (unknown.length > 0) {
      const found = skills.map((skill) => skillName(skill.name)).join(", ") || "none";
      fail(`No unmanaged skill named ${unknown.join(", ")}\nUnmanaged skills: ${found}`);
    }
    return { selected: skills.filter((skill) => names.includes(skill.name)), asked: false };
  }
  if (options.all || skills.length === 0) return { selected: skills, asked: false };
  requireTTY("nik adopt needs to know which skills", "Pass skill names or --all.");
  const picked = unwrap(
    await p.multiselect<string>({
      message: "Select skills to adopt",
      options: skills.map((skill) => ({
        value: skill.name,
        label: skill.name,
        hint: skill.agents.join(", "),
      })),
      required: false,
    }),
  );
  return { selected: skills.filter((skill) => picked.includes(skill.name)), asked: true };
};

const asLocal = (skill: UnmanagedSkill, scope: Scope, note: string): Resolved => {
  const anchor = localAnchor(skill.dirs[0]!, scope);
  const outside = scope === "project" && anchor.dir === "/";
  return {
    skill,
    source: anchor.id,
    path: anchor.root,
    root: anchor.root,
    revision: { track: "auto" },
    files: skill.files,
    integrity: skill.integrity,
    matched: false,
    note: outside ? `${note}, path outside the project` : note,
  };
};

const matchedNote = (hint: UpstreamHint | undefined, rewrite: boolean): string =>
  [...(hint ? [`from ${hint.via}`] : []), ...(rewrite ? ["drops gh skill metadata"] : [])].join(
    ", ",
  );

const asMatched = (
  skill: UnmanagedSkill,
  anchored: Anchored,
  match: Match,
  hint: UpstreamHint | undefined,
): Resolved => ({
  skill,
  source: anchored.source.id,
  path: [anchored.root, match.path].filter(Boolean).join("/"),
  root: anchored.root || undefined,
  revision: match.revision,
  files: match.files,
  integrity: match.integrity,
  matched: true,
  note: matchedNote(hint, match.integrity !== skill.integrity),
});

const resolveOne = async (
  skill: UnmanagedSkill,
  scope: Scope,
  from: Source | undefined,
  hints: Map<string, UpstreamHint>,
): Promise<Resolved> => {
  const hint = from ? undefined : (ghSkillHint(skill.files) ?? hints.get(skill.name));
  // A hint comes from a file on disk, so its ssh clone must not stop at a prompt.
  const source = from ?? (hint ? new GitSource(hint.source, { sshBatch: true }) : undefined);
  if (!source) return asLocal(skill, scope, "no known source");
  const match = await matchSkill(source, { name: skill.name, files: skill.files, ...hint });
  if (!match) return asLocal(skill, scope, `no match in ${friendlySource(source.display)}`);
  return asMatched(skill, source.forScope(scope), match, hint);
};

const resolveAll = async (
  skills: UnmanagedSkill[],
  scope: Scope,
  from: Source | undefined,
): Promise<Resolved[]> => {
  const hints = from ? new Map<string, UpstreamHint>() : await readSkillsLockHints(scope);
  const failed: Array<[string, unknown]> = [];
  const resolved = await withSpinner(
    `Matching ${skills.length} skill(s) with their sources`,
    async () => {
      const found: Resolved[] = [];
      for (const skill of skills) {
        try {
          found.push(await resolveOne(skill, scope, from, hints));
        } catch (e) {
          failed.push([skill.name, e]);
        }
      }
      return found;
    },
    (found) => {
      const matched = found.filter((item) => item.matched).length;
      return `${matched} matched a source, ${found.length - matched} local`;
    },
  );
  for (const [name, error] of failed) logSkillError(name, error);
  if (failed.length > 0) process.exitCode = 1;
  return resolved;
};

const preview = (resolved: Resolved[], file: string): void => {
  const label = (item: Resolved): string =>
    displayLabel({ ...item.revision, integrity: item.integrity });
  const nameWidth = Math.max(...resolved.map((item) => Bun.stringWidth(item.skill.name)));
  const labelWidth = Math.max(...resolved.map((item) => Bun.stringWidth(label(item))));
  p.log.step(`Skills to record in ${tildify(file)}`);
  for (const [source, items] of Map.groupBy(resolved, (item) => item.source)) {
    p.log.message([
      bold(friendlySource(source)),
      ...items.map((item) => {
        const cells = [
          pad(skillName(item.skill.name), nameWidth),
          pad(label(item), labelWidth),
          item.skill.agents.join(", "),
          ...(item.note ? [dim(item.note)] : []),
        ];
        return `  ${cells.join("  ")}`;
      }),
    ]);
  }
};
