import { readLock, splitDisabled, type Lockfile } from "../install/lockfile.ts";
import { resolveScope } from "../install/scope.ts";

export const SKILLS_HELPER = "__complete-skills";

const offered = (lock: Lockfile, command: string): string[] => {
  const { enabled, disabled } = splitDisabled(lock);
  switch (command) {
    case "enable":
      return Object.keys(disabled.skills);
    case "disable":
    case "update":
      return Object.keys(enabled.skills);
    case "remove":
      return Object.keys(lock.skills);
    default:
      return [];
  }
};

export const skillCandidates = (lock: Lockfile, command: string, words: string[]): string[] =>
  offered(lock, command)
    .filter((name) => !words.includes(name))
    .toSorted();

export const completeSkills = async (command: string, words: string[]): Promise<string[]> => {
  try {
    const scope =
      resolveScope(
        {
          global: words.includes("-g") || words.includes("--global"),
          project: words.includes("-p") || words.includes("--project"),
        },
        () => {},
      ) ?? "project";
    return skillCandidates(await readLock(scope), command, words);
  } catch {
    return [];
  }
};
