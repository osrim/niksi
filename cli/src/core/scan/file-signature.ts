import { extname } from "node:path";
import { hasTextExtension, type SkillFile } from "../skill/files.ts";
import type { Finding } from "./index.ts";

type Format =
  | "PNG image"
  | "JPEG image"
  | "GIF image"
  | "WebP image"
  | "PDF document"
  | "WOFF font"
  | "WOFF2 font"
  | "ICO icon"
  | "ZIP archive"
  | "ELF executable"
  | "Mach-O executable"
  | "PE executable"
  | "#! script";

const THIN_MACH_O = [
  "\xcf\xfa\xed\xfe",
  "\xfe\xed\xfa\xcf",
  "\xce\xfa\xed\xfe",
  "\xfe\xed\xfa\xce",
];

// "?" matches any byte: a WebP stores its size at bytes 4 to 7.
const MAGIC: [Format, string[]][] = [
  ["PNG image", ["\x89PNG\r\n\x1a\n"]],
  ["JPEG image", ["\xff\xd8\xff"]],
  ["GIF image", ["GIF87a", "GIF89a"]],
  ["WebP image", ["RIFF????WEBP"]],
  ["PDF document", ["%PDF-"]],
  ["WOFF font", ["wOFF"]],
  ["WOFF2 font", ["wOF2"]],
  ["ICO icon", ["\0\0\x01\0"]],
  ["ZIP archive", ["PK\x03\x04"]],
  ["ELF executable", ["\x7fELF"]],
  ["Mach-O executable", THIN_MACH_O],
  ["#! script", ["#!"]],
];

const MEDIA: Record<string, Format> = {
  ".png": "PNG image",
  ".jpg": "JPEG image",
  ".jpeg": "JPEG image",
  ".gif": "GIF image",
  ".webp": "WebP image",
  ".pdf": "PDF document",
  ".woff": "WOFF font",
  ".woff2": "WOFF2 font",
  ".ico": "ICO icon",
};

const EXPECTED: Record<string, Format> = {
  ...MEDIA,
  ".zip": "ZIP archive",
  ".docx": "ZIP archive",
  ".xlsx": "ZIP archive",
  ".pptx": "ZIP archive",
};

const MEDIA_EXTS = ".png .jpg .jpeg .gif .webp .ico .bmp .svg .tif .tiff .avif .heic";
const AUDIO_VIDEO_EXTS = ".mp3 .mp4 .m4a .wav .ogg .flac .webm .mov .avi .mkv";
const FONT_EXTS = ".woff .woff2 .ttf .otf .eot";
const DOCUMENT_EXTS = ".pdf .doc .docx .xls .xlsx .ppt .pptx .odt .rtf .epub";
const DISGUISES = new Set(
  [MEDIA_EXTS, AUDIO_VIDEO_EXTS, FONT_EXTS, DOCUMENT_EXTS, ".md"].join(" ").split(" "),
);

const BINARY_EXECUTABLES = new Set<Format>([
  "ELF executable",
  "Mach-O executable",
  "PE executable",
]);

// "MZ" alone also starts text, so a PE needs the header that the DOS stub points to.
const isPe = (content: Buffer): boolean => {
  if (content.length < 0x40 || content.toString("latin1", 0, 2) !== "MZ") return false;
  const header = content.readUInt32LE(0x3c);
  return content.toString("latin1", header, header + 4) === "PE\0\0";
};

const FAT_ARCH_SIZE: Record<number, number> = { 0xcafebabe: 20, 0xcafebabf: 32 };

// A Java class also starts with 0xCAFEBABE and stores its major version (45 or more) where a
// universal header stores its slice count, so every slice must also hold a thin Mach-O header.
const isUniversalMachO = (content: Buffer): boolean => {
  if (content.length < 8) return false;
  const archSize = FAT_ARCH_SIZE[content.readUInt32BE(0)];
  const slices = content.readUInt32BE(4);
  if (!archSize || slices < 1 || slices >= 45 || content.length < 8 + slices * archSize) {
    return false;
  }
  return Array.from({ length: slices }, (_, i) => 8 + i * archSize + 8).every((field) => {
    const offset =
      archSize === 20 ? content.readUInt32BE(field) : Number(content.readBigUInt64BE(field));
    return THIN_MACH_O.includes(content.toString("latin1", offset, offset + 4));
  });
};

const sniff = (content: Buffer): Format | undefined => {
  if (isPe(content)) return "PE executable";
  if (isUniversalMachO(content)) return "Mach-O executable";
  const head = content.subarray(0, 12).toString("latin1");
  return MAGIC.find(([, prefixes]) =>
    prefixes.some((magic) => [...magic].every((byte, i) => byte === "?" || head[i] === byte)),
  )?.[0];
};

const extension = (file: SkillFile): string => extname(file.path).toLowerCase();

export const isMedia = (file: SkillFile): boolean => {
  const expected = MEDIA[extension(file)];
  return expected !== undefined && sniff(file.content) === expected;
};

export const misleadingExtension = (
  file: SkillFile,
): Pick<Finding, "severity" | "detail"> | undefined => {
  const format = sniff(file.content);
  const ext = extension(file);
  if (!format || !ext) return undefined;
  const detail = `${format} with a ${ext} extension`;
  const executable = BINARY_EXECUTABLES.has(format) || format === "#! script";
  if (executable && DISGUISES.has(ext)) return { severity: "critical", detail };
  const expected = EXPECTED[ext];
  const mismatch = expected !== undefined && expected !== format;
  if (mismatch || (BINARY_EXECUTABLES.has(format) && hasTextExtension(file.path))) {
    return { severity: "warn", detail };
  }
  return undefined;
};
