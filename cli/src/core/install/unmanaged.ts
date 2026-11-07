import { lstat, readdir, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Scope } from "../paths.ts";
import { readDirFiles, type SkillFile } from "../skill/files.ts";
import { integrityOf } from "../skill/integrity.ts";
import { AGENT_IDS, skillsDir, type AgentId } from "./agents.ts";
import { assertSkillsDirSafe, isManagedLink, skillPath } from "./link.ts";
import { isLockfileName, type Lockfile } from "./lockfile.ts";

// A skill directory in agent skills directories that no lockfile entry records.
export interface UnmanagedSkill {
  name: string;
  agents: AgentId[];
  // Each real directory once. Agents whose entry is a symlink to one of them read it there.
  dirs: string[];
  files: SkillFile[];
  integrity: string;
}

export interface SkippedSkill {
  name: string;
  reason: "differ" | "symlink";
  paths: string[];
  target?: string;
}

interface Found {
  agent: AgentId;
  path: string;
  real: string;
  link: boolean;
}

const entriesOf = async (scope: Scope, agent: AgentId): Promise<string[]> => {
  try {
    await assertSkillsDirSafe(scope, agent);
    return await readdir(skillsDir(scope, agent));
  } catch {
    return [];
  }
};

const probe = async (scope: Scope, agent: AgentId, name: string): Promise<Found | undefined> => {
  const path = skillPath(name, scope, agent);
  if (await isManagedLink(path, scope)) return undefined;
  const skillMd = await stat(join(path, "SKILL.md")).catch(() => null);
  if (!skillMd?.isFile()) return undefined;
  const link = (await lstat(path)).isSymbolicLink();
  return { agent, path, real: await realpath(path), link };
};

const classify = async (name: string, found: Found[]): Promise<UnmanagedSkill | SkippedSkill> => {
  const copies = found.filter((entry) => !entry.link);
  const reals = new Set(copies.map((entry) => entry.real));
  const foreign = found.find((entry) => entry.link && !reals.has(entry.real));
  if (foreign) return { name, reason: "symlink", paths: [foreign.path], target: foreign.real };
  const distinct = copies.filter(
    (entry, index) => copies.findIndex((other) => other.real === entry.real) === index,
  );
  const contents = await Promise.all(distinct.map((entry) => readDirFiles(entry.path)));
  const sums = new Set(contents.map(integrityOf));
  const dirs = distinct.map((entry) => entry.path);
  if (sums.size > 1) return { name, reason: "differ", paths: dirs };
  return {
    name,
    agents: found.map((entry) => entry.agent),
    dirs,
    files: contents[0]!,
    integrity: [...sums][0]!,
  };
};

export const findUnmanaged = async (
  scope: Scope,
  lock: Lockfile,
): Promise<{ skills: UnmanagedSkill[]; skipped: SkippedSkill[] }> => {
  const byName = new Map<string, Found[]>();
  for (const agent of AGENT_IDS) {
    for (const name of await entriesOf(scope, agent)) {
      if (name.startsWith(".") || !isLockfileName(name) || lock.skills[name] !== undefined) {
        continue;
      }
      const found = await probe(scope, agent, name);
      if (found) byName.set(name, [...(byName.get(name) ?? []), found]);
    }
  }
  const skills: UnmanagedSkill[] = [];
  const skipped: SkippedSkill[] = [];
  for (const name of [...byName.keys()].toSorted()) {
    const result = await classify(name, byName.get(name)!);
    if ("reason" in result) skipped.push(result);
    else skills.push(result);
  }
  return { skills, skipped };
};
