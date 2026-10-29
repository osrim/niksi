import { expect, test } from "bun:test";
import { MODE_FILE } from "../skill/files.ts";
import { isMedia, misleadingExtension } from "./file-signature.ts";

const file = (path: string, bytes: number[] | string) => ({
  path,
  content: Buffer.from(typeof bytes === "string" ? Buffer.from(bytes, "latin1") : bytes),
  mode: MODE_FILE,
});

const ELF = [0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00];
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0x00];

const pe = (): number[] => {
  const bytes = Buffer.alloc(0x44);
  bytes.write("MZ", 0, "latin1");
  bytes.writeUInt32LE(0x40, 0x3c);
  bytes.write("PE\0\0", 0x40, "latin1");
  return [...bytes];
};

const universal = (magic = 0xcafebabe, archSize = 20): number[] => {
  const offset = 8 + archSize;
  const bytes = Buffer.alloc(offset + 4);
  bytes.writeUInt32BE(magic, 0);
  bytes.writeUInt32BE(1, 4);
  bytes.writeUInt32BE(0x0100000c, 8);
  if (archSize === 20) bytes.writeUInt32BE(offset, 16);
  else bytes.writeBigUInt64BE(BigInt(offset), 16);
  bytes.writeUInt32BE(0xcffaedfe, offset);
  return [...bytes];
};

const JAVA_CLASS = [0xca, 0xfe, 0xba, 0xbe, 0x00, 0x00, 0x00, 0x34, 0x00, 0x1d, 0x0a, 0x00];

test("an executable under a media, font, document, or Markdown name is critical", () => {
  expect(misleadingExtension(file("assets/logo.png", ELF))).toEqual({
    severity: "critical",
    detail: "ELF executable with a .png extension",
  });
  expect(misleadingExtension(file("fonts/a.woff2", [0xcf, 0xfa, 0xed, 0xfe]))?.detail).toBe(
    "Mach-O executable with a .woff2 extension",
  );
  expect(misleadingExtension(file("assets/logo.png", universal()))?.detail).toBe(
    "Mach-O executable with a .png extension",
  );
  expect(misleadingExtension(file("logo.gif", universal(0xcafebabf, 32)))?.severity).toBe(
    "critical",
  );
  expect(misleadingExtension(file("guide.PDF", pe()))?.detail).toBe(
    "PE executable with a .pdf extension",
  );
  expect(misleadingExtension(file("notes.md", "#!/bin/sh\nid\n"))?.severity).toBe("critical");
});

test("other mismatches are warn", () => {
  expect(misleadingExtension(file("photo.jpg", PNG))).toEqual({
    severity: "warn",
    detail: "PNG image with a .jpg extension",
  });
  expect(misleadingExtension(file("guide.pdf", [0x50, 0x4b, 0x03, 0x04]))?.severity).toBe("warn");
  expect(misleadingExtension(file("data.json", ELF))?.severity).toBe("warn");
});

test("a matching or unknown signature is silent", () => {
  expect(misleadingExtension(file("logo.png", PNG))).toBeUndefined();
  expect(misleadingExtension(file("report.docx", [0x50, 0x4b, 0x03, 0x04]))).toBeUndefined();
  expect(misleadingExtension(file("bin/tool", ELF))).toBeUndefined();
  expect(misleadingExtension(file("run.sh", "#!/bin/sh\n"))).toBeUndefined();
  expect(
    misleadingExtension(file("notes.md", "MZ is a prefix, not a PE header\n")),
  ).toBeUndefined();
  expect(misleadingExtension(file("logo.png", [0x01, 0x02]))).toBeUndefined();
  expect(misleadingExtension(file("logo.png", JAVA_CLASS))).toBeUndefined();
  const archive = universal();
  archive.splice(28, 4, ...Buffer.from("!<ar"));
  expect(misleadingExtension(file("logo.png", archive))).toBeUndefined();
});

test("isMedia needs the signature of its own extension", () => {
  expect(isMedia(file("logo.png", PNG))).toBe(true);
  expect(isMedia(file("photo.JPEG", JPEG))).toBe(true);
  expect(isMedia(file("hero.webp", "RIFF\x24\0\0\0WEBP"))).toBe(true);
  expect(isMedia(file("logo.png", JPEG))).toBe(false);
  expect(isMedia(file("archive.zip", [0x50, 0x4b, 0x03, 0x04]))).toBe(false);
});
