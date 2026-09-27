import { entry, type Case } from "../test-fixture.ts";

export default [
  {
    name: "deletes a variable path",
    path: "scripts/clean.sh",
    content: '#!/bin/sh\nrm -rf "$DEST_DIR"\n',
    fire: [{ severity: "warn", line: 2 }],
  },
  {
    name: "deletes the root",
    path: "SKILL.md",
    content: entry("rm -rf /"),
    fire: [{ severity: "warn", line: 5 }],
    known: "L39 raises it to critical",
  },
  {
    name: "deletes one file",
    path: "SKILL.md",
    content: entry("rm build.log"),
    silent: "none",
  },
  {
    name: "F5 cleans node_modules",
    path: "SKILL.md",
    content: entry("Clean up with rm -rf node_modules."),
    silent: "warn",
    known: "F5, L39",
  },
] satisfies Case[];
