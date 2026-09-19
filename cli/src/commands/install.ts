import * as p from "@clack/prompts";
import type { AgentId } from "../core/install/agents.ts";
import { assertSkillsDirSafe } from "../core/install/link.ts";
import { placementOf, readLock, splitDisabled } from "../core/install/lockfile.ts";
import {
  installedSkills,
  modifiedSkills,
  recordedLocations,
  type InstalledSkill,
} from "../core/install/destination.ts";
import { shortId } from "../core/source/revision.ts";
import { resolveScope, type ScopeOptions } from "../core/install/scope.ts";
import { land, reportRestoreError, restoreSkill } from "../ui/flow.ts";
import type { CommandHelp } from "../ui/help.ts";
import { fail, isInteractive, unwrap } from "../ui/prompt.ts";
import { migrateIfLegacy } from "../ui/migrate.ts";
import { reportDisabled, reportModified } from "../ui/status.ts";
import { skillName } from "../ui/style.ts";
import { chooseAgents, warnScopeCollisions } from "../ui/destination.ts";

export const help: CommandHelp = {
  description: "Restore every skill in niksi-lock.json. Modified files need confirmation.",
  examples: ["$ nik install", "$ nik i -g", "$ nik install --agent opencode -y"],
};

interface InstallOptions extends ScopeOptions {
  yes?: boolean;
  agent?: string | string[];
}

export const run = async (options: InstallOptions): Promise<void> => {
  p.intro("nik install");
  const scope = resolveScope(options, p.log.warn) ?? "project";
  await migrateIfLegacy(scope);
  const { enabled, disabled } = splitDisabled(await readLock(scope));
  const skills = installedSkills(enabled);
  const disabledNames = Object.keys(disabled.skills).toSorted();
  reportDisabled(disabledNames, scope);
  if (skills.length === 0) {
    if (disabledNames.length === 0) p.log.info(`${scope} lockfile is empty. Run \`nik add\`.`);
    p.outro("Nothing to install.");
    return;
  }
  const links = skills.filter((skill) => placementOf(skill).kind === "link");
  const agents = links.length > 0 ? await chooseAgents(options, scope) : [];
  for (const agent of agents) {
    await assertSkillsDirSafe(scope, agent).catch((e: Error) => fail(e.message));
  }

  warnScopeCollisions(
    links.map((skill) => skill.name),
    scope,
    agents,
  );

  const modified = await modifiedSkills(skills, scope);
  let restore = false;
  if (modified.size > 0) {
    reportModified([...modified], "Restoring discards those edits and cannot be undone.");
    restore = await confirmOptional(
      `Restore ${modified.size} modified skill(s) from the source?`,
      options.yes,
    );
  }

  const installed = await land({
    items: skills,
    name: ({ name }) => name,
    apply: async (entry) => {
      const { name } = entry;
      if (modified.has(name) && !restore) {
        throw new Error(
          "modified, skipped\nCopy the edits or run `nik install -y` to discard them.",
        );
      }
      const { restored } = await restoreSkill(entry, scope, agents);
      return {
        restored,
        success: `${restored || modified.has(name) ? "restored" : "installed"} @ ${shortId(entry)}`,
      };
    },
    onError: (entry, error) => reportRestoreError(entry.name, error),
    spinner: (entry) =>
      modified.has(entry.name) && !restore ? null : `Installing ${skillName(entry.name)}`,
    scope,
    lock: null,
  });
  p.outro(
    `Installed ${installed}/${skills.length} skill(s) (${scope}: ${installLocations(skills, agents).join(", ")}).`,
  );
};

const installLocations = (skills: InstalledSkill[], linked: AgentId[]): string[] => [
  ...new Set([...linked, ...skills.flatMap(recordedLocations)]),
];

const confirmOptional = async (message: string, yes?: boolean): Promise<boolean> => {
  if (yes) return true;
  if (!isInteractive()) return false;
  return unwrap(await p.confirm({ message, initialValue: false }));
};
