import { existsSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { homedir } from "node:os";
import * as find from "empathic/find";

export const LOCKFILE_NAME = "niksi-lock.json";
export const LEGACY_LOCKFILE_NAME = "ski-lock.json";

export type Scope = "global" | "project";

export const childPath = (dir: string, name: string): string => {
  const child = join(dir, name);
  if (basename(name) !== name || dirname(child) !== dir) {
    throw new Error(`invalid skill name ${JSON.stringify(name)}`);
  }
  return child;
};

export const envPath = (name: string, required = true): string | undefined => {
  const value = process.env[name]?.trim();
  if (value === undefined || value === "") return undefined;
  if (isAbsolute(value)) return value;
  if (!required) return undefined;
  const hint = value.startsWith("~") ? " Environment variables do not expand `~`." : "";
  throw new Error(`${name} must be an absolute path, got ${JSON.stringify(value)}.${hint}`);
};

const systemHome = (): string | undefined => {
  try {
    return homedir();
  } catch {
    return undefined;
  }
};

export const userHome = (): string => {
  const home = envPath("HOME") ?? systemHome();
  if (home !== undefined && isAbsolute(home)) return home;
  throw new Error("Cannot determine your home directory. Set HOME to an absolute path.");
};

export const tildify = (path: string): string =>
  path.startsWith(userHome()) ? path.replace(userHome(), "~") : path;

export const claudeDir = (): string => envPath("CLAUDE_HOME") ?? join(userHome(), ".claude");

export const xdgRoot = (variable: string, homeSegment: string): string =>
  envPath(variable, false) ?? join(userHome(), homeSegment);

const xdgDir = (variable: string, homeSegment: string): string =>
  join(xdgRoot(variable, homeSegment), "niksi");

export const dataDir = (): string =>
  envPath("NIKSI_HOME") ?? xdgDir("XDG_DATA_HOME", join(".local", "share"));
export const configDir = (): string =>
  envPath("NIKSI_HOME") ?? xdgDir("XDG_CONFIG_HOME", ".config");
export const cacheDir = (): string => xdgDir("XDG_CACHE_HOME", ".cache");

export const storeDir = (): string => join(dataDir(), "store");
export const canonicalDir = (scope: Scope): string =>
  join(scope === "global" ? dataDir() : join(projectRoot(), ".niksi"), "skills");

const ROOT_MARKERS = [
  LOCKFILE_NAME,
  LEGACY_LOCKFILE_NAME, // ponytail: finds unmigrated ski projects. Delete in 0.5.0.
  ".agents",
  ".claude",
  ".opencode",
  ".kiro",
  ".cline",
  ".qwen",
  ".git",
];

export const projectRoot = (): string => {
  const cwd = process.cwd();
  const home = userHome();
  const marker = find.any(ROOT_MARKERS, { cwd, last: home });
  const root = marker === undefined ? cwd : dirname(marker);
  return root === home ? cwd : root;
};

export const legacyLockPath = (): string => join(dataDir(), LOCKFILE_NAME);

export const lockPath = (scope: Scope): string =>
  scope === "global" ? join(configDir(), LOCKFILE_NAME) : join(projectRoot(), LOCKFILE_NAME);

export const effectiveLockPath = (scope: Scope): string => {
  const current = lockPath(scope);
  if (scope === "project" || existsSync(current)) return current;
  const legacy = legacyLockPath();
  return existsSync(legacy) ? legacy : current;
};
