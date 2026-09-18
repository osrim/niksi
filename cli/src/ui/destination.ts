import { existsSync } from "node:fs";
import { join } from "node:path";
import * as p from "@clack/prompts";
import {
  SKILLS_DIRS,
  agentDisplay,
  ancestorSkillsDirs,
  defaultAgents,
  detectAgents,
  loadedScope,
  overlapWarnings,
  parseAgentFlag,
  shortSkillsDir,
  skillsDir,
  unreadWarnings,
  type AgentId,
  type DetectedAgent,
} from "../core/install/agents.ts";
import { readConfig, remember } from "../core/config.ts";
import { syncExcludes } from "../core/install/exclude.ts";
import { projectRoot, type Scope } from "../core/paths.ts";
import { resolveScope, type ScopeOptions } from "../core/install/scope.ts";
import { usageError } from "../core/usage.ts";
import { isInteractive, unwrap } from "./prompt.ts";
import { logWarn, warn } from "./report.ts";
import { dim, pad, skillName, tildify } from "./style.ts";

interface AgentSelection {
  agent?: string | string[];
  yes?: boolean;
}

const scopeNotice = (scope: Scope): string =>
  scope === "global"
    ? "Using global scope. Use -p for project."
    : "Using project scope. Use -g for global.";

export const chooseScope = async (
  options: ScopeOptions & { yes?: boolean },
  message = "Add where?",
): Promise<Scope> => {
  const preferred = (await readConfig()).scope ?? "project";
  const resolved = resolveScope(options, p.log.warn);
  if (resolved) {
    if (options.global || options.project) await remember({ scope: resolved });
    return resolved;
  }
  if (options.yes || !isInteractive()) {
    p.log.info(scopeNotice(preferred));
    return preferred;
  }
  const picked = unwrap(
    await p.select<Scope>({
      message,
      options: [
        { value: "project", label: "this project", hint: tildify(projectRoot()) },
        { value: "global", label: "global", hint: "every project on this machine" },
      ],
      initialValue: preferred,
    }),
  );
  await remember({ scope: picked });
  return picked;
};

export type Mode = "link" | "copy";

const VERBS = {
  link: {
    imperative: "Link",
    gerund: "Linking",
    explainer: undefined,
  },
  copy: {
    imperative: "Copy",
    gerund: "Copying",
    explainer: `Copies are real directories. The lockfile records their agents.`,
  },
} as const;

export interface AgentRow {
  value: AgentId;
  label: string;
}

export type AgentPicker =
  | { kind: "flat"; rows: AgentRow[] }
  | { kind: "grouped"; groups: { Detected: AgentRow[]; Other: AgentRow[] } };

const MAX_NAMES = 3;

const readerNames = (id: AgentId, detected: DetectedAgent[]): string => {
  const names = detected.filter((agent) => agent.reads.includes(id)).map((agent) => agent.display);
  const shown = names.slice(0, MAX_NAMES).join(", ");
  return names.length > MAX_NAMES ? `${shown} +${names.length - MAX_NAMES}` : shown;
};

export const agentRows = (
  scope: Scope,
  detected: DetectedAgent[],
  preselected: AgentId[],
): AgentPicker => {
  const paths = SKILLS_DIRS.map((dir) => shortSkillsDir(scope, dir.id));
  const nameWidth = Math.max(...SKILLS_DIRS.map((dir) => Bun.stringWidth(dir.display)));
  const pathWidth = Math.max(...paths.map((path) => Bun.stringWidth(path)));
  const rows = SKILLS_DIRS.map((dir, index) => {
    const cells = [pad(dir.display, nameWidth), pad(paths[index]!, pathWidth)];
    cells.push(dim(readerNames(dir.id, detected)));
    return { value: dir.id, label: cells.join("  ").trimEnd() };
  });
  if (detected.length === 0) return { kind: "flat", rows };
  const isRead = (row: AgentRow): boolean =>
    detected.some((agent) => agent.reads.includes(row.value));
  const isPreselected = (row: AgentRow): boolean => preselected.includes(row.value);
  return {
    kind: "grouped",
    groups: {
      Detected: [
        ...rows.filter(isPreselected),
        ...rows.filter((row) => isRead(row) && !isPreselected(row)),
      ],
      Other: rows.filter((row) => !isRead(row) && !isPreselected(row)),
    },
  };
};

export const preferredAgents = (
  scope: Scope,
  remembered: AgentId[] | undefined,
  detected: DetectedAgent[],
): AgentId[] => remembered ?? defaultAgents(scope, detected);

const NO_AGENT = "No agent detected. Using claude. Pass --agent to choose.";

export const chooseAgents = async (
  options: AgentSelection,
  scope: Scope,
  mode: Mode = "link",
): Promise<AgentId[]> => {
  const { imperative, gerund, explainer } = VERBS[mode];
  const explicit = ((): AgentId[] | null => {
    try {
      return parseAgentFlag(options.agent);
    } catch (e) {
      throw usageError((e as Error).message);
    }
  })();
  const detected = detectAgents(scope);
  if (explicit) {
    for (const warning of unreadWarnings(options.agent, scope)) warn(warning);
    await remember({ agents: explicit });
    return warnOverlap(explicit, scope, detected);
  }

  const remembered = (await readConfig()).agents;

  if (options.yes || !isInteractive()) {
    const preferred = preferredAgents(scope, remembered, detected);
    if (!remembered && detected.length === 0) warn(NO_AGENT);
    p.log.info(`${gerund} to ${preferred.join(", ")}.`);
    return warnOverlap(preferred, scope, detected);
  }

  const preferred = preferredAgents(scope, remembered, detected);
  if (detected.length === 0) warn(NO_AGENT);
  if (explainer) p.log.info(explainer);
  const picker = agentRows(scope, detected, preferred);
  const message = `${imperative} to which agents?`;
  const picked = unwrap(
    picker.kind === "flat"
      ? await p.multiselect<AgentId>({
          message,
          options: picker.rows,
          initialValues: preferred,
          required: true,
        })
      : await p.groupMultiselect<AgentId>({
          message,
          options: picker.groups,
          initialValues: preferred,
          required: true,
          selectableGroups: false,
          maxItems: 10,
        }),
  );
  await remember({ agents: picked });
  return warnOverlap(picked, scope, detected);
};

const warnOverlap = (agents: AgentId[], scope: Scope, detected: DetectedAgent[]): AgentId[] => {
  for (const warning of overlapWarnings(agents, scope, detected)) warn(warning);
  return agents;
};

export const warnAncestorCollisions = (names: string[]): void => {
  const dirs = ancestorSkillsDirs();
  if (dirs.length === 0) return;
  for (const name of names) {
    for (const dir of dirs) {
      if (existsSync(join(dir, name))) {
        logWarn(`${skillName(name)} is also at ${tildify(dir)}. opencode loads both.`);
      }
    }
  }
};

export const shadowNote = (scope: Scope, agent: AgentId): string => {
  const loads = loadedScope(agent);
  if (loads === null) return "which one loads is up to the agent.";
  return loads === scope
    ? `${agentDisplay(agent)} loads this one and ignores that one.`
    : `${agentDisplay(agent)} loads that one and ignores this install.`;
};

export const warnScopeCollisions = (names: string[], scope: Scope, agents: AgentId[]): void => {
  const other: Scope = scope === "global" ? "project" : "global";
  for (const agent of agents) {
    const dir = skillsDir(other, agent);
    if (dir === skillsDir(scope, agent)) continue;
    for (const name of names) {
      if (existsSync(join(dir, name))) {
        logWarn(`${skillName(name)} is also at ${tildify(dir)}. ${shadowNote(scope, agent)}`);
      }
    }
  }
};

export const hideLinksFromGit = async (scope: Scope): Promise<void> => {
  if (scope !== "project") return;
  const sync = await syncExcludes().catch((e: Error) => {
    logWarn(`could not update .git/info/exclude: ${e.message}`);
    return null;
  });
  if (!sync?.changed) return;
  p.log.info(
    sync.patterns.length === 0
      ? "Cleared niksi's entries from .git/info/exclude."
      : `${sync.patterns.length} link(s) hidden with .git/info/exclude. Commit niksi-lock.json.`,
  );
};
