import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CompletionFlag, CompletionSpec } from "./spec.ts";

const help: CompletionFlag = {
  short: "h",
  long: "help",
  value: "none",
  description: "Display this message",
};
const global: CompletionFlag = {
  short: "g",
  long: "global",
  value: "none",
  description: "Use global scope",
};

export const fixtureSpec: CompletionSpec = {
  commands: [
    {
      name: "add",
      aliases: [],
      description: "Add skills",
      flags: [
        global,
        { long: "agent", value: "agent", description: "Agents to install to: universal, claude" },
        { long: "path", value: "directory", description: "Write below a root" },
        { long: "report", value: "file", description: "Write a report" },
        help,
      ],
      positional: "files",
    },
    {
      name: "remove",
      aliases: ["rm"],
      description: "Remove skills",
      flags: [global, help],
      positional: "skills",
    },
    {
      name: "completion",
      aliases: [],
      description: "Print a completion script",
      flags: [help],
      positional: "shells",
    },
    {
      name: "prune",
      aliases: [],
      description: "Delete store entries",
      flags: [help],
      positional: "none",
    },
  ],
  rootFlags: [
    help,
    { short: "v", long: "version", value: "none", description: "Display version number" },
  ],
  agents: ["universal", "claude", "qwen", "cursor"],
};

export const writeNik = async (bin: string, body: string): Promise<void> => {
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, "nik"), `#!/bin/sh\n${body}\n`);
  await chmod(join(bin, "nik"), 0o755);
};

// A `nik` on PATH that answers the skills helper with fixed names and records its arguments.
export const stubNik = async (dir: string): Promise<{ bin: string; argsFile: string }> => {
  const bin = join(dir, "bin");
  const argsFile = join(dir, "stub-args");
  await writeNik(
    bin,
    `printf '%s\\n' "$@" > '${argsFile}'\nprintf 'grilling\\ntdd\\nthe writing whip\\n'`,
  );
  return { bin, argsFile };
};

const BASH_DRIVER = `source "$1"; shift; COMP_WORDS=("$@"); COMP_CWORD=$(($# - 1)); _nik; printf '%s\\n' "\${COMPREPLY[@]}"`;

// Calls the script's _nik as bash completion would. The last word is the one under the cursor.
export const bashCompleter =
  (script: string, options: { cwd: string; env: Record<string, string | undefined> }) =>
  async (...words: string[]): Promise<string[]> => {
    const child = Bun.spawn(
      ["bash", "--norc", "-c", BASH_DRIVER, "bash", script, "nik", ...words],
      {
        ...options,
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    if (stderr !== "") throw new Error(`bash completion wrote to stderr:\n${stderr}`);
    return stdout.split("\n").filter((candidate) => candidate !== "");
  };
