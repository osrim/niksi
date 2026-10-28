import { zip } from "../test-archive.ts";
import type { Case } from "../test-fixture.ts";

const dZip = zip({ name: "deep.sh", data: "echo deep\n" });
const cZip = zip({ name: "d.zip", data: dZip });
const bZip = zip({ name: "c.zip", data: cZip });

export default [
  {
    name: "a member that inflates past the ratio budget",
    path: "bomb.zip",
    content: zip({ name: "zeros.txt", data: Buffer.alloc(1024 * 1024) }),
    fire: [
      {
        severity: "warn",
        file: "bomb.zip!zeros.txt",
        detail: "inflates past the ratio budget of 100:1, not read",
      },
    ],
  },
  {
    name: "a ZIP nested four deep",
    path: "a.zip",
    content: zip({ name: "b.zip", data: bZip }),
    fire: [
      {
        severity: "warn",
        file: "a.zip!b.zip!c.zip!d.zip",
        detail: "nested 4 deep, past the depth budget of 3",
      },
    ],
  },
  {
    name: "an encrypted member",
    path: "locked.zip",
    content: zip({ name: "run.sh", data: "opaque", flags: 0x1 }),
    fire: [{ severity: "warn", file: "locked.zip!run.sh", detail: "encrypted member, not read" }],
  },
  {
    name: "bytes that are not a ZIP",
    path: "payload.zip",
    content: "PK\x03\x04",
    fire: [{ severity: "warn" }],
  },
  {
    name: "examples.zip with two CSV files",
    path: "examples.zip",
    content: zip({ name: "one.csv", data: "a,b\n1,2\n" }, { name: "two.csv", data: "c,d\n3,4\n" }),
    silent: "none",
  },
  {
    name: "a ZIP nested three deep",
    path: "b.zip",
    content: bZip,
    silent: "none",
  },
] satisfies Case[];
