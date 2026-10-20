import { readFile, mkdir } from "node:fs/promises";
import { dirname, posix, win32 } from "node:path";
import writeFileAtomic from "write-file-atomic";
import { z } from "zod";
import { AGENT_IDS, type AgentId } from "./agents.ts";
import { effectiveLockPath, type Scope } from "../paths.ts";
import { pathCopyTarget } from "./path-copy.ts";

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
  disabled?: true;
}

export interface Lockfile {
  lockfileVersion: 1;
  skills: Record<string, LockEntry>;
}

export interface LoadedLockfile {
  scope: Scope;
  file: string;
  lock: Lockfile;
}

export type Placement =
  | { kind: "link" }
  | { kind: "agent-copy"; agents: AgentId[] }
  | { kind: "path-copy"; copyPath: string };

export const placementOf = (entry: LockEntry): Placement => {
  if (entry.copyPath !== undefined) return { kind: "path-copy", copyPath: entry.copyPath };
  if (entry.agents !== undefined) return { kind: "agent-copy", agents: entry.agents };
  return { kind: "link" };
};

export const emptyLock = (): Lockfile => ({ lockfileVersion: 1, skills: {} });

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
  return (
    entry !== undefined &&
    entry.source === content.source &&
    entry.path === content.path &&
    entry.integrity === content.integrity
  );
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
  disabled?: true | undefined;
}

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
      disabled: entry.disabled,
    };
  }
  return `${JSON.stringify({ lockfileVersion: 1, skills }, null, 2)}\n`;
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

// Zod reports the first invalid key. Check specific errors before generic fields.
const EntrySchema = z
  .object({
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
      .refine(hasNormalizedSegments, {
        error: "root must be a normalized directory inside the source",
      })
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
    disabled: z.literal(true, { error: "disabled must be true or absent" }).optional(),
  })
  .refine(
    (entry) =>
      entry.copy !== undefined || (entry.agents === undefined && entry.copyPath === undefined),
    { error: "Set copy to true when an entry contains agents or copyPath" },
  )
  .refine(
    (entry) =>
      entry.copy === undefined || (entry.agents === undefined) !== (entry.copyPath === undefined),
    { error: "Set exactly one of agents or copyPath when copy is true" },
  );

// One path segment: not empty, not `.` or `..`, no separator. Looser than STANDARD_NAME in
// source/discover.ts, which only warns: fallback names such as `My_Skill` still install.
const SKILL_NAME = /^(?!\.\.?$)[^/\\]+$/u;

const LockfileSchema = z.object({
  lockfileVersion: z.literal(1, {
    error: (issue) => `unsupported lockfile version ${String(issue.input)}`,
  }),
  skills: z.record(z.string().regex(SKILL_NAME), EntrySchema).default({}),
});

export const parseLock = (text: string, file: string): Lockfile => {
  if (!text.trim()) return emptyLock();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(`${file}: ${(e as Error).message}`, { cause: e });
  }
  const parsed = LockfileSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    if (issue.code === "invalid_key") {
      const name = JSON.stringify(issue.path[1]);
      throw new Error(`${file}: ${name}: invalid skill name`, { cause: parsed.error });
    }
    const where = issue.path[0] === "skills" ? `${String(issue.path[1])}: ` : "";
    throw new Error(`${file}: ${where}${issue.message}`, { cause: parsed.error });
  }
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
      ...(entry.disabled === undefined ? {} : { disabled: entry.disabled }),
    };
  }
  return { lockfileVersion: 1, skills };
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
