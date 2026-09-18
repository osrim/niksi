import { existsSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { projectRoot, claudeDir, envPath, tildify, userHome, type Scope } from "../paths.ts";

export type AgentId = "universal" | "claude" | "opencode" | "kiro" | "cline" | "qwen";

interface SkillsDirDef {
  id: AgentId;
  display: string;
  rootDir: string;
  globalDir: () => string;
  loads: Scope | null;
}

const userPath = (...segments: string[]): string => join(userHome(), ...segments);

const xdgConfigDir = (name: string): string =>
  join(envPath("XDG_CONFIG_HOME") ?? userPath(".config"), name);

const onPath = (binary: string): boolean =>
  (process.env.PATH ?? "")
    .split(delimiter)
    .some((dir) => dir !== "" && existsSync(join(dir, binary)));

const inProject = (dir: string): boolean => existsSync(join(projectRoot(), dir));

const inUserHome = (...segments: string[]): boolean => existsSync(userPath(...segments));

export const SKILLS_DIRS: SkillsDirDef[] = [
  {
    id: "universal",
    display: "Universal",
    rootDir: ".agents",
    globalDir: () => userPath(".agents", "skills"),
    loads: null,
  },
  {
    id: "claude",
    display: "Claude Code",
    rootDir: ".claude",
    globalDir: () => join(claudeDir(), "skills"),
    loads: "global",
  },
  {
    id: "opencode",
    display: "OpenCode",
    rootDir: ".opencode",
    globalDir: () => join(xdgConfigDir("opencode"), "skills"),
    loads: "project",
  },
  {
    id: "kiro",
    display: "Kiro",
    rootDir: ".kiro",
    globalDir: () => userPath(".kiro", "skills"),
    loads: "project",
  },
  {
    id: "cline",
    display: "Cline",
    rootDir: ".cline",
    globalDir: () => userPath(".cline", "skills"),
    loads: "global",
  },
  {
    id: "qwen",
    display: "Qwen Code",
    rootDir: ".qwen",
    globalDir: () => userPath(".qwen", "skills"),
    loads: "project",
  },
];

export const AGENT_IDS: AgentId[] = SKILLS_DIRS.map((dir) => dir.id);

interface AgentDef {
  name: string;
  display: string;
  reads: Record<Scope, AgentId[]>;
  detect: () => boolean;
}

const reads = (project: AgentId[], global: AgentId[] = project): Record<Scope, AgentId[]> => ({
  project,
  global,
});

export const AGENTS: AgentDef[] = [
  {
    name: "claude",
    display: "Claude Code",
    reads: reads(["claude"]),
    detect: () => existsSync(claudeDir()) || inProject(".claude"),
  },
  {
    name: "codex",
    display: "Codex",
    reads: reads(["universal"]),
    detect: () =>
      existsSync(envPath("CODEX_HOME") ?? userPath(".codex")) ||
      existsSync("/etc/codex") ||
      onPath("codex"),
  },
  {
    name: "cursor",
    display: "Cursor",
    reads: reads(["universal", "claude"]),
    detect: () => inUserHome(".cursor") || inProject(".cursor"),
  },
  {
    name: "gemini",
    display: "Gemini CLI",
    reads: reads(["universal"]),
    detect: () => inUserHome(".gemini") || inProject(".gemini") || onPath("gemini"),
  },
  {
    name: "copilot",
    display: "GitHub Copilot",
    reads: reads(["universal", "claude"], ["universal"]),
    detect: () => inUserHome(".copilot") || onPath("copilot"),
  },
  {
    name: "windsurf",
    display: "Windsurf",
    reads: reads(["universal"]),
    detect: () => inUserHome(".codeium", "windsurf") || inProject(".windsurf"),
  },
  {
    name: "amp",
    display: "Amp",
    reads: reads(["universal", "claude"]),
    detect: () => existsSync(xdgConfigDir("amp")) || onPath("amp"),
  },
  {
    name: "antigravity",
    display: "Antigravity",
    reads: reads(["universal"], []),
    detect: () => inUserHome(".gemini", "antigravity"),
  },
  {
    name: "droid",
    display: "Factory Droid",
    reads: reads(["universal"]),
    detect: () => inUserHome(".factory") || inProject(".factory") || onPath("droid"),
  },
  {
    name: "roo",
    display: "Roo Code",
    reads: reads(["universal"]),
    detect: () => inUserHome(".roo") || inProject(".roo"),
  },
  {
    name: "zed",
    display: "Zed",
    reads: reads(["universal"]),
    detect: () => existsSync(xdgConfigDir("zed")) || onPath("zed"),
  },
  {
    name: "junie",
    display: "Junie",
    reads: reads(["universal"]),
    detect: () => inUserHome(".junie") || inProject(".junie"),
  },
  {
    name: "kilo",
    display: "Kilo Code",
    reads: reads(["universal"], []),
    detect: () => inUserHome(".kilo") || inUserHome(".kilocode") || inProject(".kilo"),
  },
  {
    name: "warp",
    display: "Warp",
    reads: reads(["universal", "claude", "opencode"]),
    detect: () => inUserHome(".warp") || onPath("warp"),
  },
  {
    name: "augment",
    display: "Augment Code",
    reads: reads(["universal", "claude"]),
    detect: () => inUserHome(".augment") || inProject(".augment"),
  },
  {
    name: "trae",
    display: "Trae",
    reads: reads(["universal"], []),
    detect: () => inUserHome(".trae") || inProject(".trae"),
  },
  {
    name: "kiro",
    display: "Kiro",
    reads: reads(["kiro"]),
    detect: () => inUserHome(".kiro") || inProject(".kiro") || onPath("kiro"),
  },
  {
    name: "cline",
    display: "Cline",
    reads: reads(["cline", "claude"], ["cline"]),
    detect: () => inUserHome(".cline") || inProject(".cline"),
  },
  {
    name: "qwen",
    display: "Qwen Code",
    reads: reads(["qwen"]),
    detect: () => inUserHome(".qwen") || inProject(".qwen"),
  },
  {
    name: "opencode",
    display: "OpenCode",
    reads: reads(["universal", "claude", "opencode"]),
    detect: () =>
      existsSync(xdgConfigDir("opencode")) || onPath("opencode") || inProject(".opencode"),
  },
];

const AGENT_NAMES = AGENTS.map((agent) => agent.name).filter(
  (name) => !AGENT_IDS.includes(name as AgentId),
);

const homeOf = (agent: AgentDef): AgentId => agent.reads.project[0]!;

const skillsDirDef = (id: AgentId): SkillsDirDef => {
  const found = SKILLS_DIRS.find((dir) => dir.id === id);
  if (!found) throw new Error(`unknown agent: ${id}`);
  return found;
};

export const agentDisplay = (id: AgentId): string => skillsDirDef(id).display;

export const loadedScope = (id: AgentId): Scope | null => skillsDirDef(id).loads;

export const skillsDir = (scope: Scope, agent: AgentId): string => {
  const def = skillsDirDef(agent);
  return scope === "global" ? def.globalDir() : join(projectRoot(), def.rootDir, "skills");
};

export const shortSkillsDir = (scope: Scope, agent: AgentId): string =>
  scope === "global" ? tildify(skillsDir(scope, agent)) : `${skillsDirDef(agent).rootDir}/skills`;

export interface DetectedAgent {
  display: string;
  reads: AgentId[];
}

export const detectAgents = (scope: Scope): DetectedAgent[] =>
  AGENTS.filter((agent) => agent.reads[scope].length > 0 && agent.detect()).map((agent) => ({
    display: agent.display,
    reads: agent.reads[scope],
  }));

const homeCount = (ids: AgentId[], detected: DetectedAgent[]): number =>
  new Set(detected.map((agent) => agent.reads[0]!).filter((home) => ids.includes(home))).size;

const compareCovers = (a: AgentId[], b: AgentId[], detected: DetectedAgent[]): number => {
  if (a.length !== b.length) return a.length - b.length;
  const homes = homeCount(b, detected) - homeCount(a, detected);
  if (homes !== 0) return homes;
  for (let i = 0; i < a.length; i++) {
    const delta = AGENT_IDS.indexOf(a[i]!) - AGENT_IDS.indexOf(b[i]!);
    if (delta !== 0) return delta;
  }
  return 0;
};

const isCover = (ids: AgentId[], detected: DetectedAgent[]): boolean =>
  detected.every((agent) => agent.reads.some((id) => ids.includes(id)));

const cover = (detected: DetectedAgent[], candidates: AgentId[] = AGENT_IDS): AgentId[] => {
  const pool = AGENT_IDS.filter((id) => candidates.includes(id));
  let best: AgentId[] | null = null;
  for (let mask = 1; mask < 1 << pool.length; mask++) {
    const ids = pool.filter((_, index) => mask & (1 << index));
    if (!isCover(ids, detected)) continue;
    if (best === null || compareCovers(ids, best, detected) < 0) best = ids;
  }
  return best ?? [];
};

const spareIds = (chosen: AgentId[], detected: DetectedAgent[]): AgentId[] => {
  const served = detected.filter((agent) => agent.reads.some((id) => chosen.includes(id)));
  const keep = cover(served, chosen);
  return chosen.filter((id) => !keep.includes(id));
};

const listDirs = (scope: Scope, ids: AgentId[]): string =>
  new Intl.ListFormat("en", { type: "conjunction" }).format(
    ids.map((id) => shortSkillsDir(scope, id)),
  );

export const defaultAgents = (
  scope: Scope,
  detected: DetectedAgent[] = detectAgents(scope),
): AgentId[] => (detected.length === 0 ? ["claude"] : cover(detected).toSorted());

export const overlapWarnings = (
  chosen: AgentId[],
  scope: Scope,
  detected: DetectedAgent[],
): string[] => {
  const spare = spareIds(chosen, detected);
  return detected.flatMap((agent) => {
    const both = AGENT_IDS.filter((id) => chosen.includes(id) && agent.reads.includes(id));
    const agentSpare = both.filter((id) => spare.includes(id));
    if (both.length < 2 || agentSpare.length === 0) return [];
    return [
      `${agent.display} also reads ${listDirs(scope, both)}. Drop ${listDirs(scope, agentSpare)} to avoid loading skills twice.`,
    ];
  });
};

export const ancestorSkillsDirs = (): string[] => {
  const home = userHome();
  const dirs: string[] = [];
  let dir = dirname(projectRoot());
  while (dir !== home && dir !== dirname(dir)) {
    for (const def of SKILLS_DIRS) {
      const candidate = join(dir, def.rootDir, "skills");
      if (existsSync(candidate)) dirs.push(candidate);
    }
    if (existsSync(join(dir, ".git"))) break;
    dir = dirname(dir);
  }
  return dirs;
};

const agentTokens = (value: string | string[] | undefined): string[] =>
  value === undefined
    ? []
    : (Array.isArray(value) ? value : [value])
        .flatMap((item) => String(item).split(","))
        .map((item) => item.trim().toLowerCase())
        .filter((item) => item !== "");

const isAgentId = (token: string): token is AgentId => AGENT_IDS.includes(token as AgentId);

const agentByNameOnly = (token: string): AgentDef | undefined =>
  isAgentId(token) ? undefined : AGENTS.find((agent) => agent.name === token);

export const parseAgentFlag = (value: string | string[] | undefined): AgentId[] | null => {
  const tokens = agentTokens(value);
  if (tokens.length === 0) return null;
  const unknown = tokens.filter(
    (token) => !isAgentId(token) && agentByNameOnly(token) === undefined,
  );
  if (unknown.length > 0) {
    throw new Error(
      `Unknown agent(s): ${unknown.join(", ")}\nIds: ${AGENT_IDS.join(", ")}\nAgents: ${AGENT_NAMES.join(", ")}`,
    );
  }
  const ids = tokens.map((token) => (isAgentId(token) ? token : homeOf(agentByNameOnly(token)!)));
  return [...new Set(ids)];
};

export const unreadWarnings = (value: string | string[] | undefined, scope: Scope): string[] =>
  agentTokens(value).flatMap((token) => {
    const agent = agentByNameOnly(token);
    if (agent === undefined || agent.reads[scope].includes(homeOf(agent))) return [];
    const dir = shortSkillsDir(scope, homeOf(agent));
    return [`${agent.display} does not read ${dir}. Nothing loads in ${scope} scope.`];
  });
