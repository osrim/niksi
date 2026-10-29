import { entry, type Case } from "../test-fixture.ts";

export default [
  {
    name: "deletes the root",
    path: "SKILL.md",
    content: entry("rm -rf /"),
    fire: [{ severity: "critical", line: 5 }],
  },
  {
    name: "deletes system files with sudo",
    path: "scripts/clean.sh",
    content: "#!/bin/sh\nsudo rm -rf /usr/local/*\n",
    fire: [{ severity: "critical", line: 2, detail: "sudo rm -rf /usr/local/*" }],
  },
  {
    name: "deletes the home directory",
    path: "SKILL.md",
    content: entry('Run `rm -fr "$HOME"` to reset.'),
    fire: [{ severity: "critical", line: 5 }],
  },
  {
    name: "deletes a system directory among other targets",
    path: "scripts/clean.sh",
    content: "rm -r -f build /etc/ dist\n",
    fire: [{ severity: "critical", line: 1 }],
  },
  {
    name: "sudo with its own flags",
    path: "scripts/clean.sh",
    content: "sudo -E rm -rf build\n",
    fire: [{ severity: "critical", line: 1 }],
  },
  {
    name: "sudo as another user",
    path: "scripts/clean.sh",
    content: "sudo -u root rm -rf build\n",
    fire: [{ severity: "critical", line: 1 }],
  },
  {
    name: "sudo with an end of options",
    path: "scripts/clean.sh",
    content: "sudo -- rm -rf build\n",
    fire: [{ severity: "critical", line: 1 }],
  },
  {
    name: "sudo in an earlier command",
    path: "scripts/clean.sh",
    content: "sudo apt-get update && rm -rf build\n",
    silent: "info",
  },
  {
    name: "deletes under a variable that may be empty",
    path: "scripts/clean.sh",
    content: '#!/bin/sh\nrm -rf "$STEAMROOT/"*\n',
    fire: [{ severity: "critical", line: 2 }],
  },
  {
    name: "deletes a variable path",
    path: "scripts/clean.sh",
    content: '#!/bin/sh\nrm -rf "$DEST_DIR"\n',
    fire: [{ severity: "info", line: 2 }],
  },
  {
    name: "F5 cleans node_modules",
    path: "SKILL.md",
    content: entry("Clean up with rm -rf node_modules."),
    fire: [{ severity: "info", line: 5, detail: "rm -rf node_modules." }],
  },
  {
    name: "zeroes a disk",
    path: "SKILL.md",
    content: entry("dd if=/dev/zero of=/dev/sda"),
    fire: [{ severity: "critical", line: 5 }],
  },
  {
    name: "creates a filesystem on a partition",
    path: "scripts/format.sh",
    content: "mkfs.ext4 /dev/sda1\n",
    fire: [{ severity: "critical", line: 1 }],
  },
  {
    name: "a fork bomb",
    path: "scripts/run.sh",
    content: ":(){ :|:& };:\n",
    fire: [{ severity: "critical", line: 1 }],
  },
  {
    name: "discards local commits",
    path: "SKILL.md",
    content: entry("git reset --hard origin/main"),
    fire: [{ severity: "warn", line: 5 }],
  },
  {
    name: "a variable guarded against empty",
    path: "scripts/clean.sh",
    content: '#!/bin/sh\nrm -rf "${STEAMROOT:?}/"*\n',
    silent: "info",
  },
  {
    name: "a path under the home directory",
    path: "SKILL.md",
    content: entry("rm -rf ~/.cache/probe"),
    silent: "info",
  },
  {
    name: "deletes one file",
    path: "SKILL.md",
    content: entry("rm build.log"),
    silent: "none",
  },
  {
    name: "deletes the root without recursion",
    path: "SKILL.md",
    content: entry("rm -f /"),
    silent: "none",
  },
] satisfies Case[];
