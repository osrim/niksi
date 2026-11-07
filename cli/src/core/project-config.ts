import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { projectRoot, type Scope } from "./paths.ts";
import { usageError } from "./usage.ts";

export const PROJECT_CONFIG_NAME = "niksi.json";

const GITHUB_ORG = /^[a-z\d](?:[a-z\d-]*[a-z\d])?$/iu;

const GITHUB_ERROR = "must list organization names, such as osrim";
const GIT_ERROR = "must list repository URLs, such as https://git.example.com/team/skills";

const SourcesSchema = z.strictObject(
  {
    github: z
      .array(z.string({ error: GITHUB_ERROR }).regex(GITHUB_ORG, { error: GITHUB_ERROR }), {
        error: GITHUB_ERROR,
      })
      .optional(),
    git: z
      .array(z.string({ error: GIT_ERROR }).min(1, { error: GIT_ERROR }), { error: GIT_ERROR })
      .optional(),
  },
  { error: "must be an object" },
);

const ProjectConfigSchema = z.strictObject(
  {
    minimumReleaseAge: z
      .number({ error: "must be a whole number of days, 0 or more" })
      .int({ error: "must be a whole number of days, 0 or more" })
      .nonnegative({ error: "must be a whole number of days, 0 or more" })
      .optional(),
    policy: z
      .strictObject({ sources: SourcesSchema.optional() }, { error: "must be an object" })
      .optional(),
  },
  { error: "must be a JSON object" },
);

export type ProjectConfig = z.output<typeof ProjectConfigSchema>;
export type ProjectPolicy = NonNullable<ProjectConfig["policy"]>;

const keyPath = (path: PropertyKey[]): string =>
  path.filter((segment) => typeof segment === "string").join(".");

const parseError = (file: string, error: z.ZodError): Error => {
  const issue = error.issues[0]!;
  if (issue.code === "unrecognized_keys") {
    return usageError(`${file}: unknown key ${keyPath([...issue.path, issue.keys[0]!])}`);
  }
  const key = keyPath(issue.path);
  return usageError(`${file}: ${key === "" ? "" : `${key} `}${issue.message}`);
};

export const parseProjectConfig = (text: string, file: string): ProjectConfig => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw usageError(`${file}: ${(e as Error).message}`);
  }
  const parsed = ProjectConfigSchema.safeParse(raw);
  if (!parsed.success) throw parseError(file, parsed.error);
  return parsed.data;
};

export const projectConfigPath = (): string => join(projectRoot(), PROJECT_CONFIG_NAME);

export const readProjectConfig = async (scope: Scope): Promise<ProjectConfig> => {
  if (scope === "global") return {};
  const file = projectConfigPath();
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw usageError(`${file}: ${(e as Error).message}`);
  }
  return parseProjectConfig(text, file);
};
