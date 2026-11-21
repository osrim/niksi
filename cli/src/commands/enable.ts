import { loadLock, recordLinkAgents, splitDisabled } from "../core/install/lockfile.ts";
import { installedSkills, locationsOf } from "../core/install/destination.ts";
import { resolveScope, type ScopeOptions } from "../core/install/scope.ts";
import { policyViolations } from "../core/policy.ts";
import { readProjectConfig } from "../core/project-config.ts";
import { displayLabel } from "../core/source/revision.ts";
import { checkAgentFlag, restoreAgents, warnLinkCollisions } from "../ui/destination.ts";
import { land, reportRestoreError, restoreSkill } from "../ui/flow.ts";
import type { CommandHelp } from "../ui/help.ts";
import { selectRecorded } from "../ui/pick.ts";
import { intro, outro } from "../ui/prompt.ts";
import { logWarn } from "../ui/report.ts";
import { emptyScopeMessage, refuseViolations } from "../ui/status.ts";
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
  checkAgentFlag(options.agent);
  intro("nik enable");
  const scope = resolveScope(options, logWarn) ?? "project";
  const { policy } = await readProjectConfig(scope);

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
  refuseViolations(policyViolations(policy, selected), "Nothing enabled.");
  const agents = await restoreAgents(selected, options, scope);
  warnLinkCollisions(selected, scope, agents);

  await land({
    items: selected,
    name: ({ name }) => name,
    apply: async (entry) => {
      const applied = await restoreSkill(entry, scope, agents);
      const recorded = loaded.lock.skills[entry.name]!;
      recordLinkAgents(recorded, agents);
      delete recorded.disabled;
      return { ...applied, success: `enabled @ ${displayLabel(entry)}` };
    },
    onError: (entry, error) => reportRestoreError(entry, scope, error),
    spinner: (entry) => `Enabling ${skillName(entry.name)}`,
    scope,
    lock: loaded,
    outro: (enabled) => `Enabled ${enabled} skill(s). Scope: ${scope}.`,
  });
};
