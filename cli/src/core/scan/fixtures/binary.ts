import type { Case } from "../test-fixture.ts";

export default [
  {
    name: "bytes with NUL",
    path: "bin.dat",
    content: new Uint8Array([0x00, 0x01, 0x02]),
    fire: [{ severity: "warn" }],
  },
  { name: "a text file", path: "notes.txt", content: "plain text\n", silent: "none" },
  {
    name: "an archive is not also a binary",
    path: "payload.zip",
    content: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]),
    silent: "none",
  },
  {
    name: "F13 a PNG image",
    path: "assets/logo.png",
    content: new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    ]),
    silent: "warn",
    known: "F13",
  },
] satisfies Case[];
