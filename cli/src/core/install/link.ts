import { mkdir, rm, symlink, lstat, readlink, realpath, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { skillsDir, SKILLS_DIRS, type AgentId } from "./agents.ts";
import type { SkillFile } from "../skill/files.ts";
import { integrityOfDir } from "../skill/integrity.ts";
import { canonicalDir, childPath, dataDir, storeDir, tildify, type Scope } from "../paths.ts";
import { replaceDir } from "./replace.ts";
import { isInside, present, realpathOrNearest, unmanagedError } from "./target.ts";

const isSymlinkPath = async (path: string): Promise<boolean> => {
  try {
    return (await lstat(path)).isSymbolicLink();
  } catch {
    return false;
  }
};

const linkTarget = async (path: string): Promise<string> =>
  resolve(await realpathOrNearest(dirname(path)), await readlink(path));

// The location of `dest`, plus the target it would create when it is a dangling symlink.
const destPaths = async (path: string): Promise<string[]> => {
  const location = await realpathOrNearest(path);
  if (!(await isSymlinkPath(path)) || existsSync(path)) return [location];
  return [location, await realpathOrNearest(await linkTarget(path))];
};

// Where a forbidden root sits as configured, where it resolves, and where it points when dangling.
const rootPaths = async (root: string): Promise<string[]> => {
  const location = join(await realpathOrNearest(dirname(root)), basename(root));
  return [...new Set([location, ...(await destPaths(root))])];
};

// Names the `skills` link at its real location when the agent dir is a link that does not cross on its own.
const crossingLink = async (dest: string, roots: string[]): Promise<string> => {
  const agentDir = dirname(dest);
  if (!(await isSymlinkPath(agentDir))) return dest;
  const throughParent = join(await realpathOrNearest(agentDir), basename(dest));
  return roots.some((root) => isInside(throughParent, root)) ? agentDir : throughParent;
};

interface Forbidden {
  label: string;
  roots: string[];
}

interface Containment extends Forbidden {
  resolved: string;
}

const containmentError = async (
  scope: Scope,
  dest: string,
  { label, roots, resolved }: Containment,
): Promise<Error> => {
  const agentDir = dirname(dest);
  const unlinked = join(
    await realpathOrNearest(dirname(agentDir)),
    basename(agentDir),
    basename(dest),
  );
  if (resolved === unlinked) {
    const remedy =
      scope === "global"
        ? "Choose a global agent directory outside it."
        : "Run from a project outside it.";
    return new Error(`${dest} is inside ${label} (${resolved}).\n${remedy}`);
  }
  const link = await crossingLink(dest, roots);
  return new Error(
    `${dest} points into ${label} (${resolved}) through the symlink ${link}.\nRemove ${link} and re-run.`,
  );
};

const forbiddenRoots = (scope: Scope): Promise<Forbidden[]> => {
  // The store sits inside the data directory, so it comes first to get the narrower name.
  const roots = [
    { label: "the store", root: storeDir() },
    { label: "niksi's data directory", root: dataDir() },
  ];
  if (scope === "project") {
    for (const def of SKILLS_DIRS)
      roots.push({ label: "a global skills directory", root: def.globalDir() });
  }
  return Promise.all(
    roots.map(async ({ label, root }) => ({ label, roots: await rootPaths(root) })),
  );
};

export const assertSkillsDirSafe = async (scope: Scope, agent: AgentId): Promise<string> => {
  const dest = skillsDir(scope, agent);
  const canonical = canonicalDir(scope);
  const paths = await destPaths(dest);
  const realCanonical = await realpathOrNearest(canonical);
  if (paths.includes(realCanonical)) {
    throw new Error(
      `${dest} and ${canonical} are the same directory.\nski keeps skill copies in ${canonical} and links agents to them. Remove the symlink and re-run.`,
    );
  }
  const forbidden = await forbiddenRoots(scope);
  for (const resolved of paths) {
    const hit = forbidden.find(({ roots }) => roots.some((root) => isInside(resolved, root)));
    if (hit) throw await containmentError(scope, dest, { ...hit, resolved });
  }
  return dest;
};

export const skillPath = (name: string, scope: Scope, agent: AgentId): string =>
  childPath(skillsDir(scope, agent), name);

export const canonicalPath = (name: string, scope: Scope): string =>
  childPath(canonicalDir(scope), name);

export const isManagedLink = async (path: string, scope: Scope): Promise<boolean> => {
  if (!(await isSymlinkPath(path))) return false;
  try {
    return isInside(await linkTarget(path), await realpathOrNearest(canonicalDir(scope)));
  } catch {
    return false;
  }
};

const isUnmanaged = async (path: string, scope: Scope): Promise<boolean> =>
  present(path) && !(await isManagedLink(path, scope));

const displayPath = (path: string): string => {
  const rel = relative(process.cwd(), path);
  return rel.startsWith("..") ? tildify(path) : rel;
};

export const refuseUnmanaged = async (
  name: string,
  scope: Scope,
  agent: AgentId,
): Promise<void> => {
  const path = skillPath(name, scope, agent);
  if (await isUnmanaged(path, scope)) throw unmanagedError(displayPath(path));
};

export const linkedAgents = async (name: string, scope: Scope): Promise<AgentId[]> => {
  const hits = await Promise.all(
    SKILLS_DIRS.map(async (dir) =>
      (await isManagedLink(skillPath(name, scope, dir.id), scope)) ? dir.id : null,
    ),
  );
  return hits.filter((id): id is AgentId => id !== null);
};

export const linkReachesCanonical = async (
  name: string,
  scope: Scope,
  agent: AgentId,
): Promise<boolean> => {
  try {
    const [target, canonical] = await Promise.all([
      realpath(skillPath(name, scope, agent)),
      realpath(canonicalPath(name, scope)),
    ]);
    return target === canonical;
  } catch {
    return false;
  }
};

export const occupiedAgents = (name: string, scope: Scope): AgentId[] =>
  SKILLS_DIRS.filter((dir) => present(skillPath(name, scope, dir.id))).map((dir) => dir.id);

export const resolvedAgents = (name: string, scope: Scope): AgentId[] =>
  SKILLS_DIRS.filter((dir) => existsSync(skillPath(name, scope, dir.id))).map((dir) => dir.id);

export const linkSkill = async (name: string, scope: Scope, agent: AgentId): Promise<void> => {
  const path = skillPath(name, scope, agent);
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  await refuseUnmanaged(name, scope, agent);
  await rm(path, { force: true });
  // Resolve both ends so the link still holds when an agent dir is itself a symlink.
  const from = await realpathOrNearest(dir);
  const to = await realpathOrNearest(canonicalPath(name, scope));
  await symlink(relative(from, to), path);
};

export const copySkill = async (
  name: string,
  files: SkillFile[],
  scope: Scope,
  agent: AgentId,
  managed: boolean,
): Promise<string | undefined> => {
  if (!managed) await refuseUnmanaged(name, scope, agent);
  return replaceDir(skillPath(name, scope, agent), files);
};

export const removeCopy = (name: string, scope: Scope, agent: AgentId): Promise<void> =>
  rm(skillPath(name, scope, agent), { recursive: true, force: true });

export const writeCanonical = async (
  name: string,
  files: SkillFile[],
  scope: Scope,
): Promise<string | undefined> => {
  const path = canonicalPath(name, scope);
  await mkdir(dirname(path), { recursive: true });
  if (scope === "project") {
    const ignore = join(canonicalDir(scope), "..", ".gitignore");
    if (!existsSync(ignore)) await writeFile(ignore, "*\n");
  }
  return replaceDir(path, files);
};

export const removeCanonical = (name: string, scope: Scope): Promise<void> =>
  rm(canonicalPath(name, scope), { recursive: true, force: true });

export const dirModified = async (path: string, integrity: string): Promise<boolean> =>
  present(path) && (await integrityOfDir(path)) !== integrity;

export interface CopyState {
  missing: AgentId[];
  modified: AgentId[];
}

export const copyState = async (
  name: string,
  integrity: string,
  scope: Scope,
  agents: AgentId[],
): Promise<CopyState> => {
  const state: CopyState = { missing: [], modified: [] };
  for (const agent of agents) {
    const path = skillPath(name, scope, agent);
    if (!existsSync(path)) state.missing.push(agent);
    else if (await dirModified(path, integrity)) state.modified.push(agent);
  }
  return state;
};

export const unlinkSkill = async (name: string, scope: Scope, agent: AgentId): Promise<void> => {
  const path = skillPath(name, scope, agent);
  if (await isUnmanaged(path, scope)) {
    throw new Error(`${displayPath(path)} is not managed by niksi. Delete it yourself.`);
  }
  await rm(path, { recursive: true, force: true });
};
