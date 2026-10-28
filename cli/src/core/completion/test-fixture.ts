import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cac } from "cac";

export const fixtureCli = () => {
  const cli = cac("nik");
  cli
    .command("add <coordinate> [...skills]", "Add skills")
    .option("-g, --global", "Use global scope")
    .option("--agent <id>", "Agents to install to: universal, claude")
    .option("--path <directory>", "Write below a root")
    .option("--report <file>", "Write a report");
  cli
    .command("remove [...skills]", "Remove skills")
    .alias("rm")
    .option("-g, --global", "Use global scope");
  cli.command("completion <shell>", "Print a completion script");
  cli.command("prune", "Delete store entries");
  cli.help();
  cli.version("1.0.0");
  return cli;
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
  await writeNik(bin, `printf '%s\\n' "$@" > '${argsFile}'\nprintf 'grilling\\ntdd\\n'`);
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
