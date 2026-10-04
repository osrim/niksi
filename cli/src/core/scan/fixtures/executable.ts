import { MODE_EXEC } from "../../skill/files.ts";
import type { Case } from "../test-fixture.ts";

export default [
  {
    name: "a binary with the executable bit",
    path: "bin/tool",
    content: new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]),
    mode: MODE_EXEC,
    fire: [{ severity: "warn", detail: "executable file" }],
  },
  {
    name: "text without a shebang",
    path: "notes.md",
    content: "echo hi\n",
    mode: MODE_EXEC,
    fire: [{ severity: "warn", detail: "executable file" }],
  },
  {
    name: "F14 a shell script with a shebang",
    path: "scripts/run.sh",
    content: "#!/bin/sh\necho hi\n",
    mode: MODE_EXEC,
    fire: [{ severity: "info", detail: "executable script" }],
  },
  {
    name: "a script without the executable bit",
    path: "scripts/run.sh",
    content: "#!/bin/sh\necho hi\n",
    silent: "none",
  },
] satisfies Case[];
