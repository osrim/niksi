import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { z } from "zod";
import { projectRoot, userHome, type Scope } from "../paths.ts";
import type { SkillFile } from "../skill/files.ts";
import { parseFrontmatter } from "../skill/frontmatter.ts";
import { parseCoordinate } from "./coordinate.ts";

// Where another installer says a skill came from. `match.ts` checks it against the content.
export interface UpstreamHint {
  source: string;
  path?: string;
  pinned?: string;
  tree?: string;
  via: string;
}

const gitSource = (raw: string): string | undefined => {
  try {
    const coordinate = parseCoordinate(raw);
    if (coordinate.kind !== "git" || coordinate.skill || coordinate.ref || coordinate.tree) {
      return undefined;
    }
    return coordinate.repo;
  } catch {
    return undefined;
  }
};

const skillDir = (path: string): string | undefined => {
  const normalized = posix.normalize(path);
  if (posix.isAbsolute(normalized) || normalized === ".." || normalized.startsWith("../")) {
    return undefined;
  }
  return normalized === "." ? "" : normalized;
};

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

const optional = <K extends string>(
  key: K,
  value: string | undefined,
): Partial<Record<K, string>> =>
  (value === undefined ? {} : { [key]: value }) as Partial<Record<K, string>>;

const readSkillMd = (files: SkillFile[]): Record<string, unknown> => {
  const skill = files.find((file) => file.path === "SKILL.md");
  if (!skill) return {};
  try {
    return parseFrontmatter(skill.content.toString("utf8"));
  } catch {
    return {};
  }
};

// `gh skill install` writes these keys under `metadata` in SKILL.md.
export const ghSkillHint = (files: SkillFile[]): UpstreamHint | undefined => {
  const metadata = readSkillMd(files)["metadata"];
  if (typeof metadata !== "object" || metadata === null) return undefined;
  const fields = metadata as Record<string, unknown>;
  const repo = text(fields["github-repo"]);
  const path = text(fields["github-path"]);
  const source = repo === undefined ? undefined : gitSource(repo);
  const dir = path === undefined ? undefined : skillDir(path);
  if (source === undefined || dir === undefined) return undefined;
  return {
    source,
    path: dir,
    ...optional("pinned", text(fields["github-pinned"])),
    ...optional("tree", text(fields["github-tree-sha"])),
    via: "gh skill metadata",
  };
};

// `npx skills` writes version 1 in the project and version 3 in ~/.agents, which gh skill shares.
const SkillsLockSchema = z.object({
  version: z.literal([1, 3]),
  skills: z.record(
    z.string(),
    z.object({
      source: z.string(),
      sourceType: z.string(),
      sourceUrl: z.string().optional(),
      skillPath: z.string().optional(),
      ref: z.string().optional(),
      pinnedRef: z.string().optional(),
      skillFolderHash: z.string().optional(),
    }),
  ),
});

type SkillsLockEntry = z.infer<typeof SkillsLockSchema>["skills"][string];

const GITHUB_SHORTHAND = /^[\w.-]+\/[\w.-]+$/u;

const entrySource = (entry: SkillsLockEntry): string | undefined => {
  const shorthand = entry.sourceType === "github" && GITHUB_SHORTHAND.test(entry.source);
  const github = `https://github.com/${entry.source}`;
  if (shorthand && (entry.sourceUrl === undefined || entry.sourceUrl === `${github}.git`)) {
    return github;
  }
  if (!["github", "gitlab", "git"].includes(entry.sourceType)) return undefined;
  return gitSource(entry.sourceUrl ?? entry.source);
};

const entryHint = (entry: SkillsLockEntry, via: string): UpstreamHint | undefined => {
  const source = entrySource(entry);
  if (source === undefined) return undefined;
  const path = entry.skillPath === undefined ? undefined : skillDir(posix.dirname(entry.skillPath));
  if (entry.skillPath !== undefined && path === undefined) return undefined;
  return {
    source,
    ...optional("path", path),
    ...optional("pinned", entry.pinnedRef ?? entry.ref),
    ...optional("tree", entry.skillFolderHash),
    via,
  };
};

export const skillsLockHints = (raw: string, via: string): Map<string, UpstreamHint> => {
  const hints = new Map<string, UpstreamHint>();
  let parsed: z.ZodSafeParseResult<z.infer<typeof SkillsLockSchema>>;
  try {
    parsed = SkillsLockSchema.safeParse(JSON.parse(raw));
  } catch {
    return hints;
  }
  if (!parsed.success) return hints;
  for (const [name, entry] of Object.entries(parsed.data.skills)) {
    const hint = entryHint(entry, via);
    if (hint) hints.set(name, hint);
  }
  return hints;
};

export const skillsLockPath = (scope: Scope): string =>
  scope === "project"
    ? join(projectRoot(), "skills-lock.json")
    : join(userHome(), ".agents", ".skill-lock.json");

export const readSkillsLockHints = async (scope: Scope): Promise<Map<string, UpstreamHint>> => {
  const file = skillsLockPath(scope);
  const raw = await readFile(file, "utf8").catch(() => "");
  return skillsLockHints(
    raw,
    scope === "project" ? "skills-lock.json" : "~/.agents/.skill-lock.json",
  );
};
