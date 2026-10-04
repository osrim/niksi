import type { Case } from "../test-fixture.ts";

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d];

export default [
  {
    name: "bytes with NUL",
    path: "bin.dat",
    content: new Uint8Array([0x00, 0x01, 0x02]),
    fire: [{ severity: "warn", detail: "binary file" }],
  },
  {
    name: "a media extension on other bytes",
    path: "assets/logo.png",
    content: new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x00]),
    fire: [{ severity: "warn", detail: "binary file" }],
  },
  {
    name: "a JPEG named as a PNG",
    path: "assets/logo.png",
    content: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
    fire: [{ severity: "warn", detail: "binary file" }],
  },
  {
    name: "F13 a PNG image",
    path: "assets/logo.png",
    content: new Uint8Array(PNG),
    fire: [{ severity: "info", detail: "media file (.png)" }],
  },
  {
    name: "a JPEG photo",
    path: "assets/photo.JPEG",
    content: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
    fire: [{ severity: "info", detail: "media file (.jpeg)" }],
  },
  {
    name: "a WebP image",
    path: "assets/hero.webp",
    content: new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    ]),
    fire: [{ severity: "info" }],
  },
  {
    name: "a WOFF2 font",
    path: "fonts/inter.woff2",
    content: new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0x00, 0x01, 0x00, 0x00]),
    fire: [{ severity: "info" }],
  },
  {
    name: "an icon",
    path: "favicon.ico",
    content: new Uint8Array([0x00, 0x00, 0x01, 0x00, 0x01, 0x00]),
    fire: [{ severity: "info" }],
  },
  { name: "a text file", path: "notes.txt", content: "plain text\n", silent: "none" },
  {
    name: "an archive is not also a binary",
    path: "payload.zip",
    content: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]),
    silent: "none",
  },
] satisfies Case[];
