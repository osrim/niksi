import { assertSkillsDirSafe } from "../core/install/link.ts";
import { loadLock, placementOf, splitDisabled } from "../core/install/lockfile.ts";
import { installedSkills, locationsOf } from "../core/install/destination.ts";
import { resolveScope, type ScopeOptions } from "../core/install/scope.ts";
import { displayLabel } from "../core/source/revision.ts";
import { chooseAgents, warnScopeCollisions } from "../ui/destination.ts";
import { land, reportRestoreError, restoreSkill } from "../ui/flow.ts";
import type { CommandHelp } from "../ui/help.ts";
import { migrateIfLegacy } from "../ui/migrate.ts";
import { selectRecorded } from "../ui/pick.ts";
import { fail, intro, outro, promptWarn } from "../ui/prompt.ts";
import { emptyScopeMessage } from "../ui/status.ts";
import { skillName } from "../ui/style.ts";

export const help: CommandHelp = {
  description:
    "Restore disabled skills from niksi-lock.json at their recorded revision, with no new review. A source such as owner/repo or a local path selects every skill from it.",
  examples: [
    "$ nik enable",
    "$ nik enable grilling",
    "$ nik enable owner/repo -y",
    "$ nik enable --all --agent claude -y",
  ],
};

interface EnableOptions extends ScopeOptions {
  all?: boolean;
  yes?: boolean;
  agent?: string | string[];
}

export const run = async (args: string[], options: EnableOptions): Promise<void> => {
  intro("nik enable");
  const scope = resolveScope(options, promptWarn) ?? "project";
  await migrateIfLegacy(scope);

  const loaded = await loadLock(scope);
  if (Object.keys(loaded.lock.skills).length === 0) {
    outro(await emptyScopeMessage(scope));
    return;
  }
  const skills = installedSkills(splitDisabled(loaded.lock).disabled);
  const { names, asked } = await selectRecorded(args, {
    command: "enable",
    lock: loaded.lock,
    locations: await locationsOf(skills, scope),
    offered: skills.map((skill) => skill.name),
    all: options.all,
  });
  if (names.length === 0) {
    outro(asked ? "Nothing selected." : "Nothing to enable.");
    return;
  }

  const selected = skills.filter((skill) => names.includes(skill.name));
  const links = selected.filter((skill) => placementOf(skill).kind === "link");
  const agents = links.length > 0 ? await chooseAgents(options, scope) : [];
  for (const agent of agents) {
    await assertSkillsDirSafe(scope, agent).catch((e: Error) => fail(e.message));
  }
  warnScopeCollisions(
    links.map((skill) => skill.name),
    scope,
    agents,
  );

  await land({
    items: selected,
    name: ({ name }) => name,
    apply: async (entry) => {
      const { restored } = await restoreSkill(entry, scope, agents);
      delete loaded.lock.skills[entry.name]!.disabled;
      return { restored, success: `enabled @ ${displayLabel(entry)}` };
    },
    onError: (entry, error) => reportRestoreError(entry.name, error),
    spinner: (entry) => `Enabling ${skillName(entry.name)}`,
    scope,
    lock: loaded,
    outro: (enabled) => `Enabled ${enabled} skill(s). Scope: ${scope}.`,
  });
};
