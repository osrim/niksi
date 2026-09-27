import { MODE_EXEC } from "../../skill/files.ts";
import type { Case } from "../test-fixture.ts";

export default [
  {
    name: "a binary with the executable bit",
    path: "bin/tool",
    content: new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]),
    mode: MODE_EXEC,
    fire: [{ severity: "warn" }],
  },
  {
    name: "a script without the executable bit",
    path: "scripts/run.sh",
    content: "#!/bin/sh\necho hi\n",
    silent: "none",
  },
  {
    name: "F14 a shell script with a shebang",
    path: "scripts/run.sh",
    content: "#!/bin/sh\necho hi\n",
    mode: MODE_EXEC,
    silent: "warn",
    known: "F14",
  },
] satisfies Case[];
