import type { Case } from "../test-fixture.ts";

export default [
  { name: "a zip file", path: "payload.zip", content: "PK\x03\x04", fire: [{ severity: "warn" }] },
  {
    name: "a gzipped tarball",
    path: "vendor/lib.tar.gz",
    content: new Uint8Array([0x1f, 0x8b, 0x08, 0x00]),
    fire: [{ severity: "warn" }],
  },
  { name: "docs about archives", path: "docs/archive.md", content: "Zip it.\n", silent: "none" },
] satisfies Case[];
