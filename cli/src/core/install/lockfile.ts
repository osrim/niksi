import { readFile, mkdir } from "node:fs/promises";
import { dirname, posix, win32 } from "node:path";
import writeFileAtomic from "write-file-atomic";
import { z } from "zod";
import { AGENT_IDS, type AgentId } from "./agents.ts";
import { effectiveLockPath, type Scope } from "../paths.ts";
import { pathCopyTarget } from "./path-copy.ts";
import { sameSkill } from "../source/index.ts";

export interface LockEntry {
  source: string;
  branch?: string;
  path: string;
  root?: string;
  commit?: string;
  integrity: string;
  track: "auto" | "pin";
  pinnedAs?: string;
  tag?: string;
  copy?: true;
  agents?: AgentId[];
  copyPath?: string;
  review?: Review;
  disabled?: true;
}

export interface ExternalVerdict {
  tool: string;
  version: string;
  result: string;
  findings: number;
}

export interface Review {
  acceptedRules?: string[];
  external?: ExternalVerdict;
}

export interface Lockfile {
  lockfileVersion: 2;
  skills: Record<string, LockEntry>;
}

export interface LoadedLockfile {
  scope: Scope;
  file: string;
  lock: Lockfile;
}

export type Placement =
  | { kind: "link"; agents: AgentId[] }
  | { kind: "agent-copy"; agents: AgentId[] }
  | { kind: "path-copy"; copyPath: string };

export const placementOf = (entry: LockEntry): Placement => {
  if (entry.copyPath !== undefined) return { kind: "path-copy", copyPath: entry.copyPath };
  if (entry.copy) return { kind: "agent-copy", agents: entry.agents ?? [] };
  return { kind: "link", agents: entry.agents ?? [] };
};

// A link entry from a version 1 lockfile records no agents until a write names them.
export const recordLinkAgents = (entry: LockEntry, agents: AgentId[]): void => {
  if (placementOf(entry).kind === "link" && entry.agents === undefined && agents.length > 0) {
    entry.agents = agents;
  }
};

export const emptyLock = (): Lockfile => ({ lockfileVersion: 2, skills: {} });

export const splitDisabled = (lock: Lockfile): { enabled: Lockfile; disabled: Lockfile } => {
  const enabled = emptyLock();
  const disabled = emptyLock();
  for (const [name, entry] of Object.entries(lock.skills)) {
    (entry.disabled ? disabled : enabled).skills[name] = entry;
  }
  return { enabled, disabled };
};

export const isApproved = (
  lock: Lockfile,
  name: string,
  content: { source: string; path: string; integrity: string },
): boolean => {
  const entry = lock.skills[name];
  return entry !== undefined && sameSkill(entry, content) && entry.integrity === content.integrity;
};

interface SerializedEntry {
  source: string;
  branch?: string | undefined;
  path: string;
  root?: string | undefined;
  commit?: string | undefined;
  integrity: string;
  track: "auto" | "pin";
  pinnedAs?: string | undefined;
  tag?: string | undefined;
  copy?: true | undefined;
  agents?: AgentId[] | undefined;
  copyPath?: string | undefined;
  review?: Review | undefined;
  disabled?: true | undefined;
}

const serializeReview = ({
  acceptedRules,
  external,
}: {
  acceptedRules?: string[] | undefined;
  external?: ExternalVerdict | undefined;
}): Review => ({
  ...(acceptedRules === undefined ? {} : { acceptedRules }),
  ...(external === undefined
    ? {}
    : {
        external: {
          tool: external.tool,
          version: external.version,
          result: external.result,
          findings: external.findings,
        },
      }),
});

export const serializeLock = (lock: Lockfile): string => {
  const skills: Record<string, SerializedEntry> = {};
  for (const name of Object.keys(lock.skills).toSorted()) {
    const entry = lock.skills[name]!;
    skills[name] = {
      source: entry.source,
      branch: entry.branch,
      path: entry.path,
      root: entry.root,
      commit: entry.commit,
      integrity: entry.integrity,
      track: entry.track,
      pinnedAs: entry.pinnedAs,
      tag: entry.tag,
      copy: entry.copy,
      agents: entry.agents,
      copyPath: entry.copyPath,
      review: entry.review === undefined ? undefined : serializeReview(entry.review),
      disabled: entry.disabled,
    };
  }
  return `${JSON.stringify({ lockfileVersion: 2, skills }, null, 2)}\n`;
};

const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

// Git reads an argument that starts with `-` as an option, and any other scheme or
// `<transport>::` runs a remote helper.
const SOURCE_SHAPES = [
  /^local:./u,
  /^(?:https|ssh|file):\/\/./u,
  /^(?:[^-@/:][^@/:]*@)?(?:\[[^\]-][^\]]*\]|[^-@/:[][^@/:]*):(?!:|\/\/)./u,
];

const hasNormalizedSegments = (path: string): boolean =>
  path.split("/").every((segment) => !["", ".", ".."].includes(segment));

const RULE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

const ReviewSchema = z
  .object({
    acceptedRules: z
      .array(
        z
          .string()
          .regex(RULE_ID, { error: "acceptedRules must hold rule ids such as curl-pipe-shell" }),
      )
      .nonempty({ error: "acceptedRules must name at least one rule" })
      .optional(),
    external: z
      .object({
        tool: z.string().min(1),
        version: z.string().min(1),
        result: z.string().min(1),
        findings: z.number().int().nonnegative(),
      })
      .optional(),
  })
  .refine((review) => review.acceptedRules !== undefined || review.external !== undefined, {
    error: "review must contain acceptedRules or external",
  });

// Zod reports the first invalid key. Check specific errors before generic fields.
const ENTRY_FIELDS = {
  track: z.enum(["auto", "pin"], {
    error: (issue) => `unknown track ${JSON.stringify(issue.input)}`,
  }),
  integrity: z
    .string({ error: "missing integrity" })
    .regex(/^sha256-[A-Za-z0-9+/]{43}=$/u, { error: "integrity must be sha256-<base64>" }),
  source: z.string().refine((source) => SOURCE_SHAPES.some((shape) => shape.test(source)), {
    error: "source must be local:<path>, an https, ssh, or file URL, or user@host:path",
  }),
  branch: z.string().optional(),
  path: z.string(),
  root: z
    .string()
    .refine(
      (root) =>
        !root.includes("\\") &&
        !posix.isAbsolute(root) &&
        !win32.isAbsolute(root) &&
        hasNormalizedSegments(root),
      { error: "root must be a normalized directory inside the source" },
    )
    .optional(),
  commit: z
    .string()
    .regex(COMMIT, { error: "commit must be a 40- or 64-character lowercase hex hash" })
    .optional(),
  pinnedAs: z.string().optional(),
  tag: z.string().optional(),
  copy: z.literal(true).optional(),
  agents: z
    .array(z.enum(AGENT_IDS))
    .nonempty({ error: "agents must name at least one agent" })
    .optional(),
  copyPath: z
    .string()
    .refine(
      (path) =>
        path === "." ||
        (!path.includes("\\") &&
          !posix.isAbsolute(path) &&
          !win32.isAbsolute(path) &&
          hasNormalizedSegments(path)),
      { error: "Use a normalized project-relative destination root for copyPath" },
    )
    .optional(),
};

const DISABLED = z.literal(true, { error: "disabled must be true or absent" }).optional();

const onePlacement = (entry: {
  copy?: true | undefined;
  agents?: unknown;
  copyPath?: unknown;
}): boolean =>
  entry.copy === undefined || (entry.agents === undefined) !== (entry.copyPath === undefined);

const ONE_PLACEMENT = { error: "Set exactly one of agents or copyPath when copy is true" };

// Version 1 recorded agents only for agent copies and had no review.
const EntryV1Schema = z
  .object({ ...ENTRY_FIELDS, disabled: DISABLED })
  .refine(
    (entry) =>
      entry.copy !== undefined || (entry.agents === undefined && entry.copyPath === undefined),
    { error: "Set copy to true when an entry contains agents or copyPath" },
  )
  .refine(onePlacement, ONE_PLACEMENT);

const EntrySchema = z
  .object({ ...ENTRY_FIELDS, review: ReviewSchema.optional(), disabled: DISABLED })
  .refine((entry) => entry.copy !== undefined || entry.copyPath === undefined, {
    error: "Set copy to true when an entry contains copyPath",
  })
  .refine(onePlacement, ONE_PLACEMENT);

// One path segment: not empty, not `.` or `..`, no separator. Looser than STANDARD_NAME in
// source/discover.ts, which only warns: fallback names such as `My_Skill` still install.
const SKILL_NAME = /^(?!\.\.?$)[^/\\]+$/u;

const VersionSchema = z.object({
  lockfileVersion: z.literal([1, 2], {
    error: (issue) => `unsupported lockfile version ${String(JSON.stringify(issue.input))}`,
  }),
});

const lockfileSchema = <T extends z.ZodType>(entry: T) =>
  z.object({ skills: z.record(z.string().regex(SKILL_NAME), entry).default({}) });

const LockfileSchemas = { 1: lockfileSchema(EntryV1Schema), 2: lockfileSchema(EntrySchema) };

const parseError = (file: string, error: z.ZodError): Error => {
  const issue = error.issues[0]!;
  if (issue.code === "invalid_key") {
    const name = JSON.stringify(issue.path[1]);
    return new Error(`${file}: ${name}: invalid skill name`, { cause: error });
  }
  const where = issue.path[0] === "skills" ? `${String(issue.path[1])}: ` : "";
  return new Error(`${file}: ${where}${issue.message}`, { cause: error });
};

export const parseLock = (text: string, file: string): Lockfile => {
  if (!text.trim()) return emptyLock();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(`${file}: ${(e as Error).message}`, { cause: e });
  }
  const version = VersionSchema.safeParse(raw);
  if (!version.success) throw parseError(file, version.error);
  const parsed: z.ZodSafeParseResult<{ skills: Record<string, z.infer<typeof EntrySchema>> }> =
    LockfileSchemas[version.data.lockfileVersion].safeParse(raw);
  if (!parsed.success) throw parseError(file, parsed.error);
  const skills: Record<string, LockEntry> = {};
  for (const [name, entry] of Object.entries(parsed.data.skills)) {
    skills[name] = {
      source: entry.source,
      ...(entry.branch === undefined ? {} : { branch: entry.branch }),
      path: entry.path,
      ...(entry.root === undefined ? {} : { root: entry.root }),
      ...(entry.commit === undefined ? {} : { commit: entry.commit }),
      integrity: entry.integrity,
      track: entry.track,
      ...(entry.pinnedAs === undefined ? {} : { pinnedAs: entry.pinnedAs }),
      ...(entry.tag === undefined ? {} : { tag: entry.tag }),
      ...(entry.copy === undefined ? {} : { copy: entry.copy }),
      ...(entry.agents === undefined ? {} : { agents: entry.agents }),
      ...(entry.copyPath === undefined ? {} : { copyPath: entry.copyPath }),
      ...(entry.review === undefined ? {} : { review: serializeReview(entry.review) }),
      ...(entry.disabled === undefined ? {} : { disabled: entry.disabled }),
    };
  }
  return { lockfileVersion: 2, skills };
};

const readLockFile = async (scope: Scope, file: string): Promise<Lockfile> => {
  try {
    const lock = parseLock(await readFile(file, "utf8"), file);
    for (const [name, entry] of Object.entries(lock.skills)) {
      if (!entry.copyPath) continue;
      if (scope === "global") {
        throw new Error(`${file}: ${name}: path copies require project scope`);
      }
      await pathCopyTarget(name, entry.copyPath).catch((e: Error) => {
        throw new Error(`${file}: ${name}: ${e.message}`, { cause: e });
      });
    }
    return lock;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    return emptyLock();
  }
};

export const readLock = (scope: Scope): Promise<Lockfile> =>
  readLockFile(scope, effectiveLockPath(scope));

export const loadLock = async (scope: Scope): Promise<LoadedLockfile> => {
  const file = effectiveLockPath(scope);
  return { scope, file, lock: await readLockFile(scope, file) };
};

export const writeLock = async ({ file, lock }: LoadedLockfile): Promise<void> => {
  await mkdir(dirname(file), { recursive: true });
  await writeFileAtomic(file, serializeLock(lock));
};
