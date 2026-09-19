import * as p from "@clack/prompts";
import type { AgentId } from "../core/install/agents.ts";
import { applySkill } from "../core/install/apply.ts";
import { installDestination, type InstalledSkill } from "../core/install/destination.ts";
import type { DiscoveredSkill } from "../core/source/discover.ts";
import { sourceFor, type Source } from "../core/source/index.ts";
import type { SkillFile } from "../core/skill/files.ts";
import { writeLock, type LoadedLockfile } from "../core/install/lockfile.ts";
import { IntegrityError } from "../core/install/store.ts";
import type { Scope } from "../core/paths.ts";
import { failNoTTY, isInteractive, unwrap, withSpinner } from "./prompt.ts";
import { logError, logSkillError } from "./report.ts";
import { warnRestored } from "./status.ts";
import { skillName } from "./style.ts";
import { hideLinksFromGit } from "./destination.ts";

export interface SkillFiles {
  skill: DiscoveredSkill;
  files: SkillFile[];
}

export const fetchSkillFiles = (
  source: Source,
  rev: string | undefined,
  skills: DiscoveredSkill[],
): Promise<SkillFiles[]> =>
  withSpinner(
    `Fetching ${skills.length} skill(s) from ${source.display}`,
    async () => {
      const fetched: SkillFiles[] = [];
      for (const skill of skills) {
        fetched.push({ skill, files: await source.fetchFiles(rev, skill.path) });
      }
      return fetched;
    },
    (fetched) => `Fetched ${fetched.length} skill(s) from ${source.display}`,
  );

export const restoreSkill = async (
  entry: InstalledSkill,
  scope: Scope,
  agents: AgentId[],
): Promise<{ restored: boolean }> => {
  const destination = await installDestination(entry, scope, agents);
  const source = sourceFor(entry.source);
  return applySkill(
    {
      name: entry.name,
      source: entry.source,
      path: entry.path,
      revision: entry,
      integrity: entry.integrity,
      files: () => source.fetchFiles(entry.commit, entry.path),
    },
    destination,
  );
};

export const reportRestoreError = (name: string, error: unknown): void => {
  if (!(error instanceof IntegrityError)) {
    logSkillError(name, error);
    return;
  }
  logError(
    [
      `${skillName(name)}: source files do not match niksi-lock.json`,
      `  expected  ${error.expected}`,
      `  actual    ${error.actual}`,
      "Run `nik add` to re-review the content.",
    ].join("\n"),
  );
};

interface ConfirmOptions {
  yes?: boolean | undefined;
  command: string;
  initialValue?: boolean;
}

export const confirm = async (message: string, options: ConfirmOptions): Promise<boolean> => {
  if (options.yes) return true;
  if (!isInteractive()) {
    failNoTTY(`nik ${options.command} needs confirmation`, "Pass -y to proceed.");
  }
  return unwrap(await p.confirm({ message, initialValue: options.initialValue ?? true }));
};

interface Landing<T> {
  items: T[];
  name: (item: T) => string;
  apply: (item: T) => Promise<LandingResult>;
  onError?: (item: T, error: unknown) => void;
  spinner?: (item: T) => string | null;
  scope: Scope;
  lock: LoadedLockfile | null;
  outro?: (applied: number) => string;
}

interface LandingResult {
  success: string;
  restored?: boolean;
}

export const land = async <T>({
  items,
  name,
  apply,
  onError,
  spinner,
  scope,
  lock,
  outro,
}: Landing<T>): Promise<number> => {
  let applied = 0;
  let failed = 0;
  for (const item of items) {
    try {
      const message = spinner?.(item);
      const result = message
        ? await withSpinner(
            message,
            () => apply(item),
            (outcome) => `${skillName(name(item))}: ${outcome.success}`,
          )
        : await apply(item);
      if (result.restored) warnRestored(name(item));
      if (!message) p.log.success(`${skillName(name(item))}: ${result.success}`);
      applied++;
    } catch (e) {
      if (onError) onError(item, e);
      else logSkillError(name(item), e);
      failed++;
    }
  }
  if (failed > 0) process.exitCode = process.exitCode === 3 ? 3 : 1;
  if (lock) await writeLock(lock);
  await hideLinksFromGit(scope);
  if (outro) p.outro(outro(applied));
  return applied;
};
