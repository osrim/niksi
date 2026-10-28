import { basename, dirname, join, normalize } from "node:path";
import { gunzipSync, inflateRawSync } from "node:zlib";
import { MODE_EXEC, MODE_FILE, MODE_SYMLINK, type SkillFile } from "../skill/files.ts";

export interface Unread {
  file: string;
  detail: string;
}

// `chain` holds the archive path, then each member path down to this one, such as
// `["tools.zip", "docs.zip", "x.md"]`. `path` joins them with "!" for display.
export interface Member extends SkillFile {
  chain: string[];
}

export interface ArchiveContents {
  members: Member[];
  unread: Unread[];
}

const MAX_DEPTH = 3;
const MAX_MEMBERS = 1000;
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_RATIO = 100;
const MAX_MS = 5000;

const ZIP_EXTS = [".zip", ".docx", ".xlsx", ".pptx"];
const GZIP_EXTS = [".tar.gz", ".tgz"];
const TAR_EXTS = [".tar"];

const isMember = (file: SkillFile): file is Member => "chain" in file;

// A file on disk is one part, even when its name holds "!".
export const pathParts = (file: SkillFile): string[] => (isMember(file) ? file.chain : [file.path]);

// A member at the root of an archive, such as `tools.zip!plugin.json`, has no "/" before its name.
export const fileName = (file: SkillFile): string => basename(pathParts(file).at(-1)!);

// A name in `tools.zip!docs/a.md` resolves inside that archive: `b.md` is `tools.zip!docs/b.md`.
export const namedPaths = (file: SkillFile, name: string): string[] => {
  const parts = pathParts(file);
  const archive = parts
    .slice(0, -1)
    .map((part) => `${part}!`)
    .join("");
  return [join(dirname(parts.at(-1)!), name), name].map((path) => archive + normalize(path));
};

// The regex exists to find control characters.
// oxlint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001F\u007F]/gu;

const showControl = (name: string): string =>
  name.replace(CONTROL, (char) => `^${String.fromCharCode(char.charCodeAt(0) ^ 0x40)}`);

interface Entry {
  name: string;
  mode: string;
  data: Buffer;
  deflated: boolean;
  // The size the headers declare after inflating.
  inflatedSize: number;
  problem?: string | undefined;
}

const unixMode = (mode: number): string => {
  if ((mode & 0o170000) === 0o120000) return MODE_SYMLINK;
  return mode & 0o111 ? MODE_EXEC : MODE_FILE;
};

const ZIP_END = 0x06054b50;
const ZIP_CENTRAL = 0x02014b50;
const ZIP_LOCAL = 0x04034b50;
const ZIP64 = 0xffffffff;
const STORED = 0;
const DEFLATED = 8;
const UNIX = 3;

const findZipEnd = (buf: Buffer): number => {
  for (let at = buf.length - 22; at >= Math.max(0, buf.length - 22 - 0xffff); at--) {
    if (buf.readUInt32LE(at) === ZIP_END) return at;
  }
  throw new Error("no ZIP central directory");
};

const zipProblem = (flags: number, method: number): string | undefined => {
  if (flags & 0x1) return "encrypted member";
  if (method !== STORED && method !== DEFLATED) return `unsupported compression method ${method}`;
  return undefined;
};

const zipEntry = (buf: Buffer, at: number): Entry => {
  if (buf.readUInt32LE(at) !== ZIP_CENTRAL) throw new Error("broken ZIP central directory");
  const flags = buf.readUInt16LE(at + 8);
  const method = buf.readUInt16LE(at + 10);
  const packedSize = buf.readUInt32LE(at + 20);
  const inflatedSize = buf.readUInt32LE(at + 24);
  const local = buf.readUInt32LE(at + 42);
  if ([packedSize, inflatedSize, local].includes(ZIP64)) throw new Error("ZIP64 is not supported");
  if (buf.readUInt32LE(local) !== ZIP_LOCAL) throw new Error("broken ZIP local header");
  const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
  if (start + packedSize > buf.length) throw new Error("truncated ZIP member");
  return {
    name: buf.toString("utf8", at + 46, at + 46 + buf.readUInt16LE(at + 28)),
    mode: buf[at + 5] === UNIX ? unixMode(buf.readUInt32LE(at + 38) >>> 16) : MODE_FILE,
    data: buf.subarray(start, start + packedSize),
    deflated: method === DEFLATED,
    inflatedSize,
    problem: zipProblem(flags, method),
  };
};

const zipEntries = (buf: Buffer): Entry[] => {
  const end = findZipEnd(buf);
  const entries: Entry[] = [];
  let at = buf.readUInt32LE(end + 16);
  for (let i = buf.readUInt16LE(end + 10); i > 0; i--) {
    const entry = zipEntry(buf, at);
    if (!entry.name.endsWith("/")) entries.push(entry);
    at += 46 + buf.readUInt16LE(at + 28) + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
  }
  return entries;
};

const BLOCK = 512;

const field = (header: Buffer, start: number, length: number): string => {
  const raw = header.subarray(start, start + length);
  const nul = raw.indexOf(0);
  return raw.toString("utf8", 0, nul === -1 ? raw.length : nul);
};

const octal = (header: Buffer, start: number, length: number): number => {
  const value = Number.parseInt(field(header, start, length).trim() || "0", 8);
  if (!Number.isSafeInteger(value)) throw new Error("broken tar header");
  return value;
};

const checksumMatches = (header: Buffer): boolean => {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : header[i]!;
  return sum === octal(header, 148, 8);
};

const paxPath = (data: Buffer): string | undefined =>
  /(?:^|\n)\d+ path=([^\n]*)\n/u.exec(data.toString("utf8"))?.[1];

const stored = (name: string, mode: string, data: Buffer, problem?: string): Entry => ({
  name,
  mode,
  data,
  deflated: false,
  inflatedSize: data.length,
  problem,
});

const tarEntry = (header: Buffer, name: string, data: Buffer): Entry | undefined => {
  const type = field(header, 156, 1) || "0";
  if (type === "5" || type === "g") return undefined;
  if (type === "2") return stored(name, MODE_SYMLINK, Buffer.from(field(header, 157, 100)));
  const problem = type === "0" || type === "7" ? undefined : `unsupported tar entry type ${type}`;
  return stored(name, unixMode(octal(header, 100, 8)), data, problem);
};

const tarName = (header: Buffer): string => {
  const prefix = field(header, 345, 155);
  return (prefix ? `${prefix}/` : "") + field(header, 0, 100);
};

const tarEntries = (buf: Buffer): Entry[] => {
  const entries: Entry[] = [];
  let longName: string | undefined;
  for (let at = 0; at + BLOCK <= buf.length;) {
    const header = buf.subarray(at, at + BLOCK);
    if (header.every((byte) => byte === 0)) break;
    if (!checksumMatches(header)) throw new Error("broken tar header");
    const size = octal(header, 124, 12);
    if (at + BLOCK + size > buf.length) throw new Error("truncated tar member");
    const data = buf.subarray(at + BLOCK, at + BLOCK + size);
    at += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
    const type = field(header, 156, 1);
    if (type === "L" || type === "x") {
      longName = type === "L" ? field(data, 0, data.length) : paxPath(data);
      continue;
    }
    const entry = tarEntry(header, (longName ?? tarName(header)).replace(/^(?:\.\/)+/u, ""), data);
    longName = undefined;
    if (entry) entries.push(entry);
  }
  return entries;
};

const endsWithAny = (path: string, exts: string[]): boolean =>
  exts.some((ext) => path.toLowerCase().endsWith(ext));

const isArchive = (path: string): boolean =>
  endsWithAny(path, [...ZIP_EXTS, ...GZIP_EXTS, ...TAR_EXTS]);

interface Walk extends ArchiveContents {
  now: () => number;
  deadline: number;
  bytes: number;
  stopped: boolean;
}

const SIZE_BUDGET = `inflated size budget of ${MAX_BYTES / 1024 / 1024} MiB`;
const RATIO_BUDGET = `inflates past the ratio budget of ${MAX_RATIO}:1, not read`;

const skip = (walk: Walk, file: string, detail: string): undefined => {
  walk.unread.push({ file, detail });
  return undefined;
};

const stop = (walk: Walk, file: string, budget: string): undefined => {
  walk.stopped = true;
  return skip(walk, file, `${budget} reached, the rest is not read`);
};

const isTooLarge = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "ERR_BUFFER_TOO_LARGE";

// The output cap stops a bomb while it inflates, whatever size its headers declare.
const inflate = (
  walk: Walk,
  path: string,
  unzip: typeof inflateRawSync,
  data: Buffer,
  { declared, ratioCap }: { declared: number; ratioCap: number },
): Buffer | undefined => {
  const left = MAX_BYTES - walk.bytes;
  if (declared > ratioCap) return skip(walk, path, RATIO_BUDGET);
  if (declared > left) return stop(walk, path, SIZE_BUDGET);
  try {
    return unzip(data, { maxOutputLength: Math.max(1, Math.min(ratioCap, left)) });
  } catch (error) {
    if (!isTooLarge(error)) throw error;
    return ratioCap <= left ? skip(walk, path, RATIO_BUDGET) : stop(walk, path, SIZE_BUDGET);
  }
};

// A tar pads each member to 512 bytes, so the ratio counts member bytes only.
// The size budget counts the members as they are taken.
const gzipEntries = (walk: Walk, file: SkillFile): Entry[] => {
  const tarball = inflate(walk, file.path, gunzipSync, file.content, {
    declared: 0,
    ratioCap: Number.POSITIVE_INFINITY,
  });
  if (!tarball) return [];
  const entries = tarEntries(tarball);
  const bytes = entries.reduce((total, entry) => total + entry.data.length, 0);
  if (bytes <= file.content.length * MAX_RATIO) return entries;
  skip(walk, file.path, RATIO_BUDGET);
  return [];
};

const openArchive = (walk: Walk, file: SkillFile): Entry[] => {
  try {
    if (endsWithAny(file.path, ZIP_EXTS)) return zipEntries(file.content);
    if (endsWithAny(file.path, GZIP_EXTS)) return gzipEntries(walk, file);
    return tarEntries(file.content);
  } catch (error) {
    skip(walk, file.path, `archive could not be read: ${(error as Error).message}`);
    return [];
  }
};

const memberContent = (walk: Walk, path: string, entry: Entry): Buffer | undefined => {
  if (!entry.deflated) {
    return entry.data.length > MAX_BYTES - walk.bytes ? stop(walk, path, SIZE_BUDGET) : entry.data;
  }
  try {
    return inflate(walk, path, inflateRawSync, entry.data, {
      declared: entry.inflatedSize,
      ratioCap: entry.data.length * MAX_RATIO,
    });
  } catch (error) {
    return skip(walk, path, `member could not be read: ${(error as Error).message}`);
  }
};

const takeMember = (walk: Walk, chain: string[], entry: Entry): Member | undefined => {
  const path = chain.join("!");
  if (walk.now() > walk.deadline)
    return stop(walk, path, `time budget of ${MAX_MS / 1000} seconds`);
  if (walk.members.length >= MAX_MEMBERS) {
    return stop(walk, path, `member budget of ${MAX_MEMBERS.toLocaleString("en-US")}`);
  }
  if (entry.problem) return skip(walk, path, `${entry.problem}, not read`);
  const content = memberContent(walk, path, entry);
  if (!content) return undefined;
  walk.bytes += content.length;
  return { path, chain, mode: entry.mode, content };
};

const readArchive = (walk: Walk, file: SkillFile, depth: number): void => {
  if (!isArchive(file.path)) return;
  if (depth > MAX_DEPTH) {
    skip(walk, file.path, `nested ${depth} deep, past the depth budget of ${MAX_DEPTH}`);
    return;
  }
  for (const entry of openArchive(walk, file)) {
    if (walk.stopped) return;
    const member = takeMember(walk, [...pathParts(file), showControl(entry.name)], entry);
    if (!member) continue;
    walk.members.push(member);
    readArchive(walk, member, depth + 1);
  }
};

// Budgets cover all archives of one skill together. Nesting counts from the skill's own files.
export const readArchives = (
  files: SkillFile[],
  now: () => number = () => performance.now(),
): ArchiveContents => {
  const walk: Walk = {
    members: [],
    unread: [],
    now,
    deadline: now() + MAX_MS,
    bytes: 0,
    stopped: false,
  };
  for (const file of files) {
    if (walk.stopped) break;
    readArchive(walk, file, 1);
  }
  return { members: walk.members, unread: walk.unread };
};
