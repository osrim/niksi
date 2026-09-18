import { existsSync } from "node:fs";
import { mkdir, readFile, readlink, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { SKILLS_DIRS } from "./agents.ts";
import { BLOCK_BEGIN, BLOCK_END, excludeFile } from "./exclude.ts";
import { linkSkill, skillPath } from "./link.ts";
import { placementOf, readLock } from "./lockfile.ts";
import {
  cacheDir,
  configDir,
  dataDir,
  LEGACY_LOCKFILE_NAME,
  LOCKFILE_NAME,
  projectRoot,
  xdgRoot,
  type Scope,
} from "../paths.ts";
import { usageError } from "../usage.ts";

// ponytail: one-shot move from the ski 0.2 layout. Delete in 0.5.0.

const LEGACY_LINK_TARGET = /(^|\/)\.?ski\/skills\//u;
const LEGACY_BLOCK_BEGIN = "# >>> ski: managed skill links (rebuilt by `ski install`)";
const LEGACY_BLOCK_END = "# <<< ski";

interface Move {
  from: string;
  to: string;
  // Dropped instead of kept when the new path already exists: a cache or a rewritten preference.
  disposable?: true;
}

const pending = ({ from, to, disposable }: Move): boolean =>
  existsSync(from) && (disposable === true || !existsSync(to));

const legacyData = (): string => join(xdgRoot("XDG_DATA_HOME", join(".local", "share")), "ski");
const legacyConfig = (): string => join(xdgRoot("XDG_CONFIG_HOME", ".config"), "ski");
const legacyCache = (): string => join(xdgRoot("XDG_CACHE_HOME", ".cache"), "ski");

// config.json is not scoped, so it moves with either scope before a prompt can rewrite it.
const configMove = (): Move => ({
  from: join(legacyConfig(), "config.json"),
  to: join(configDir(), "config.json"),
  disposable: true,
});

// Contents move one by one because a project-scope run may already have created the new roots.
const globalMoves = (): Move[] => [
  { from: join(legacyData(), "skills"), to: join(dataDir(), "skills") },
  { from: join(legacyData(), "store"), to: join(dataDir(), "store"), disposable: true },
  { from: join(legacyData(), LEGACY_LOCKFILE_NAME), to: join(dataDir(), LOCKFILE_NAME) },
  { from: join(legacyConfig(), LEGACY_LOCKFILE_NAME), to: join(configDir(), LOCKFILE_NAME) },
  configMove(),
  { from: legacyCache(), to: cacheDir(), disposable: true },
];

const projectMoves = (): Move[] => {
  const root = projectRoot();
  return [
    { from: join(root, LEGACY_LOCKFILE_NAME), to: join(root, LOCKFILE_NAME) },
    { from: join(root, ".ski"), to: join(root, ".niksi") },
    configMove(),
  ];
};

const moves = (scope: Scope): Move[] => (scope === "global" ? globalMoves() : projectMoves());

export const legacyLayoutPresent = (scope: Scope): boolean => {
  if (process.env.SKI_HOME && !process.env.NIKSI_HOME) {
    throw usageError("SKI_HOME was renamed to NIKSI_HOME.");
  }
  return moves(scope).some(pending);
};

const apply = async ({ from, to, disposable }: Move): Promise<void> => {
  if (disposable && existsSync(to)) return rm(from, { recursive: true, force: true });
  await mkdir(dirname(to), { recursive: true });
  await rename(from, to);
};

const relinkLegacy = async (scope: Scope): Promise<void> => {
  const lock = await readLock(scope);
  for (const [name, entry] of Object.entries(lock.skills)) {
    if (placementOf(entry).kind !== "link") continue;
    for (const { id } of SKILLS_DIRS) {
      const path = skillPath(name, scope, id);
      const target = await readlink(path).catch(() => null);
      if (target === null || !LEGACY_LINK_TARGET.test(target)) continue;
      await rm(path);
      await linkSkill(name, scope, id);
    }
  }
};

const renameExcludeMarkers = async (): Promise<void> => {
  const file = await excludeFile(projectRoot());
  if (!file) return;
  const text = await readFile(file, "utf8").catch(() => null);
  if (text === null || !text.includes(LEGACY_BLOCK_BEGIN) || !text.includes(LEGACY_BLOCK_END)) {
    return;
  }
  await writeFile(
    file,
    text.replace(LEGACY_BLOCK_BEGIN, BLOCK_BEGIN).replace(LEGACY_BLOCK_END, BLOCK_END),
  );
};

export const migrateLegacyLayout = async (scope: Scope): Promise<void> => {
  for (const move of moves(scope)) {
    if (pending(move)) await apply(move);
  }
  await relinkLegacy(scope);
  if (scope === "project") await renameExcludeMarkers();
  for (const dir of [legacyData(), legacyConfig()]) await rmdir(dir).catch(() => {});
};
