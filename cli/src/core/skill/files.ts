import {
  chmod,
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, extname, join, relative, sep } from "node:path";

export interface SkillFile {
  path: string;
  content: Buffer;
  mode: string;
}

export const MODE_FILE = "100644";
export const MODE_EXEC = "100755";
export const MODE_SYMLINK = "120000";
export const MODE_GITLINK = "160000";
export const isSymlink = (mode: string): boolean => mode === MODE_SYMLINK;
const isText = (buf: Buffer): boolean => !buf.subarray(0, 1024).includes(0);

const TEXT_EXTS = new Set([
  ".md",
  ".txt",
  ".sh",
  ".bash",
  ".zsh",
  ".py",
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
]);

const isTextCandidate = (file: SkillFile): boolean =>
  TEXT_EXTS.has(extname(file.path).toLowerCase()) ||
  file.content.subarray(0, 2).toString("latin1") === "#!";

const startsWith = (buf: Buffer, ...bytes: number[]): boolean =>
  buf.length >= bytes.length && bytes.every((byte, i) => buf[i] === byte);

const decodeUtf32 = (buf: Buffer, littleEndian: boolean): string => {
  let text = "";
  for (let i = 4; i + 4 <= buf.length; i += 4) {
    const codepoint = littleEndian ? buf.readUInt32LE(i) : buf.readUInt32BE(i);
    text += codepoint <= 0x10ffff ? String.fromCodePoint(codepoint) : "\uFFFD";
  }
  return text;
};

export interface DecodedText {
  text: string;
  nuls: number;
}

const withoutNul = (decoded: string): DecodedText => {
  const text = decoded.replaceAll("\0", "");
  return { text, nuls: decoded.length - text.length };
};

const decodeCandidate = (buf: Buffer): DecodedText => {
  if (startsWith(buf, 0xff, 0xfe, 0, 0)) return withoutNul(decodeUtf32(buf, true));
  if (startsWith(buf, 0, 0, 0xfe, 0xff)) return withoutNul(decodeUtf32(buf, false));
  if (startsWith(buf, 0xff, 0xfe)) return withoutNul(new TextDecoder("utf-16le").decode(buf));
  if (startsWith(buf, 0xfe, 0xff)) return withoutNul(new TextDecoder("utf-16be").decode(buf));
  const kept = buf.filter((byte) => byte !== 0);
  return { text: Buffer.from(kept).toString("utf8"), nuls: buf.length - kept.length };
};

// A NUL must not hide the rest of a text file from the scan or the pager.
export const decodeText = (file: SkillFile): DecodedText | undefined => {
  if (isTextCandidate(file)) return decodeCandidate(file.content);
  return isText(file.content) ? { text: file.content.toString("utf8"), nuls: 0 } : undefined;
};

// Use code-unit order so integrity values do not depend on the system locale.
export const byPath = (a: { path: string }, b: { path: string }): number =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

const SKIP_DIRS = new Set([".git", "node_modules"]);

export const isSkillContent = (path: string): boolean =>
  !path.split("/").some((segment) => SKIP_DIRS.has(segment));

const walk = async (root: string, current: string, out: SkillFile[]): Promise<void> => {
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(current, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(root, full, out);
      continue;
    }
    const path = relative(root, full).split(sep).join("/");
    if (entry.isSymbolicLink()) {
      out.push({ path, content: Buffer.from(await readlink(full)), mode: MODE_SYMLINK });
      continue;
    }
    if (!entry.isFile()) continue;
    const stats = await lstat(full);
    out.push({
      path,
      content: await readFile(full),
      mode: stats.mode & 0o111 ? MODE_EXEC : MODE_FILE,
    });
  }
};

export const readDirFiles = async (dir: string): Promise<SkillFile[]> => {
  const files: SkillFile[] = [];
  await walk(dir, dir, files);
  return files.toSorted(byPath);
};

export const writeFiles = async (dest: string, files: SkillFile[]): Promise<void> => {
  if (files.length === 0) throw new Error("nothing to install: skill has no files");
  for (const file of files) {
    const out = join(dest, file.path);
    await mkdir(dirname(out), { recursive: true });
    if (isSymlink(file.mode)) {
      await symlink(file.content.toString("utf8"), out);
    } else {
      await writeFile(out, file.content);
      if (file.mode === MODE_EXEC) await chmod(out, 0o755);
    }
  }
};
