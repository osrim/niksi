import { assertSkillsDirSafe } from "../core/install/link.ts";
import { loadLock, splitDisabled } from "../core/install/lockfile.ts";
import {
  installedSkills,
  locationAgents,
  locationsOf,
  modifiedSkills,
  removeInstalledSkill,
} from "../core/install/destination.ts";
import { resolveScope, type ScopeOptions } from "../core/install/scope.ts";
import { confirm, land } from "../ui/flow.ts";
import type { CommandHelp } from "../ui/help.ts";
import { migrateIfLegacy } from "../ui/migrate.ts";
import { selectRecorded } from "../ui/pick.ts";
import { fail, intro, outro, promptWarn } from "../ui/prompt.ts";
import { emptyScopeMessage, reportModified } from "../ui/status.ts";
import { skillName } from "../ui/style.ts";

export const help: CommandHelp = {
  description:
    "Remove selected skills from disk and mark their lockfile entries disabled. A source such as owner/repo or a local path selects every skill from it. nik enable restores them without a new review.",
  examples: [
    "$ nik disable",
    "$ nik disable grilling",
    "$ nik disable owner/repo -y",
    "$ nik disable --all -g -y",
  ],
};

interface DisableOptions extends ScopeOptions {
  all?: boolean;
  yes?: boolean;
}

export const run = async (args: string[], options: DisableOptions): Promise<void> => {
  intro("nik disable");
  const scope = resolveScope(options, promptWarn) ?? "project";
  await migrateIfLegacy(scope);

  const loaded = await loadLock(scope);
  if (Object.keys(loaded.lock.skills).length === 0) {
    outro(await emptyScopeMessage(scope));
    return;
  }
  const skills = installedSkills(splitDisabled(loaded.lock).enabled);
  const locations = await locationsOf(skills, scope);
  const { names, asked } = await selectRecorded(args, {
    command: "disable",
    lock: loaded.lock,
    locations,
    offered: skills.map((skill) => skill.name),
    all: options.all,
  });
  if (names.length === 0) {
    outro(asked ? "Nothing selected." : "Nothing to disable.");
    return;
  }

  const agents = new Set(names.flatMap((name) => locationAgents(locations.get(name)!)));
  for (const agent of agents) {
    await assertSkillsDirSafe(scope, agent).catch((e: Error) => fail(e.message));
  }
  const modified = await modifiedSkills(
    skills.filter((skill) => names.includes(skill.name)),
    scope,
  );
  if (modified.size > 0) {
    reportModified([...modified], "Disabling discards those edits and cannot be undone.");
  }

  const proceed = await confirm(`Disable ${names.map(skillName).join(", ")} (${scope})?`, {
    yes: options.yes,
    command: "disable",
    initialValue: false,
  });
  if (!proceed) {
    outro("Nothing selected.");
    return;
  }

  await land({
    items: names,
    name: (name) => name,
    apply: async (name) => {
      await removeInstalledSkill(name, scope, locations.get(name)!);
      loaded.lock.skills[name]!.disabled = true;
      return { success: "disabled" };
    },
    scope,
    lock: loaded,
    outro: (disabled) => `Disabled ${disabled} skill(s). Scope: ${scope}.`,
  });
};
