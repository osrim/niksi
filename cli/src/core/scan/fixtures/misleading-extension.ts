import type { Case } from "../test-fixture.ts";

const ELF = [0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d];
const ZIP = [0x50, 0x4b, 0x03, 0x04, 0x00];

const pe = (): Uint8Array => {
  const bytes = Buffer.alloc(0x44);
  bytes.write("MZ", 0, "latin1");
  bytes.writeUInt32LE(0x40, 0x3c);
  bytes.write("PE\0\0", 0x40, "latin1");
  return bytes;
};

const universal = (): Uint8Array => {
  const bytes = Buffer.alloc(32);
  bytes.writeUInt32BE(0xcafebabe, 0);
  bytes.writeUInt32BE(1, 4);
  bytes.writeUInt32BE(0x0100000c, 8);
  bytes.writeUInt32BE(28, 16);
  bytes.writeUInt32BE(0xcffaedfe, 28);
  return bytes;
};

const JAVA_CLASS = [0xca, 0xfe, 0xba, 0xbe, 0x00, 0x00, 0x00, 0x34, 0x00, 0x1d, 0x0a, 0x00];

export default [
  {
    name: "L03 an ELF binary named as a PNG",
    path: "assets/logo.png",
    content: new Uint8Array(ELF),
    fire: [{ severity: "critical", detail: "ELF executable with a .png extension" }],
  },
  {
    name: "a Mach-O binary named as a font",
    path: "fonts/inter.woff2",
    content: new Uint8Array([0xcf, 0xfa, 0xed, 0xfe, 0x07, 0x00]),
    fire: [{ severity: "critical", detail: "Mach-O executable with a .woff2 extension" }],
  },
  {
    name: "a universal Mach-O binary named as a PNG",
    path: "assets/logo.png",
    content: universal(),
    fire: [{ severity: "critical", detail: "Mach-O executable with a .png extension" }],
  },
  {
    name: "a PE binary named as a PDF",
    path: "docs/guide.pdf",
    content: pe(),
    fire: [{ severity: "critical", detail: "PE executable with a .pdf extension" }],
  },
  {
    name: "a shell script named as Markdown",
    path: "docs/notes.md",
    content: "#!/bin/sh\nid\n",
    fire: [{ severity: "critical", detail: "#! script with a .md extension" }],
  },
  {
    name: "a PNG named as a JPEG",
    path: "assets/photo.jpg",
    content: new Uint8Array(PNG),
    fire: [{ severity: "warn", detail: "PNG image with a .jpg extension" }],
  },
  {
    name: "a ZIP named as a PDF",
    path: "docs/guide.pdf",
    content: new Uint8Array(ZIP),
    fire: [{ severity: "warn", detail: "ZIP archive with a .pdf extension" }],
  },
  {
    name: "an ELF binary named as JSON",
    path: "data.json",
    content: new Uint8Array(ELF),
    fire: [{ severity: "warn", detail: "ELF executable with a .json extension" }],
  },
  { name: "L03 a real PNG", path: "assets/logo.png", content: new Uint8Array(PNG), silent: "none" },
  { name: "a DOCX is a ZIP", path: "report.docx", content: new Uint8Array(ZIP), silent: "none" },
  {
    name: "a binary without an extension",
    path: "bin/tool",
    content: new Uint8Array(ELF),
    silent: "none",
  },
  {
    name: "a script with its own extension",
    path: "run.sh",
    content: "#!/bin/sh\nid\n",
    silent: "none",
  },
  {
    name: "Markdown that starts with MZ",
    path: "notes.md",
    content: "MZ is a prefix, not a PE header.\n",
    silent: "none",
  },
  {
    name: "a Java class shares the universal Mach-O magic",
    path: "assets/logo.png",
    content: new Uint8Array(JAVA_CLASS),
    silent: "none",
  },
] satisfies Case[];
