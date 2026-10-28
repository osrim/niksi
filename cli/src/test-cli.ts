import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";
import { emptyLock, type Lockfile } from "./core/install/lockfile.ts";

export const cli = join(import.meta.dir, "index.ts");

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type RunCli = (cwd: string, ...args: string[]) => Promise<RunResult>;

export interface Answer {
  on: string;
  send: string;
}

export type RunTerminal = (cwd: string, answers: Answer[], ...args: string[]) => Promise<RunResult>;

export const cliEnv = (home: string): Record<string, string | undefined> => ({
  ...process.env,
  HOME: home,
  NIKSI_HOME: join(home, "niksi-home"),
  XDG_CONFIG_HOME: join(home, ".config"),
  XDG_DATA_HOME: join(home, ".local", "share"),
  XDG_CACHE_HOME: join(home, ".cache"),
  CLAUDE_HOME: undefined,
  CI: "1",
  NO_COLOR: "1",
  FORCE_COLOR: undefined,
  TERM: "dumb",
});

export const cliRunner =
  (home: string): RunCli =>
  async (cwd, ...args) => {
    const child = Bun.spawn([process.execPath, cli, ...args], {
      cwd,
      env: cliEnv(home),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { exitCode, stdout, stderr };
  };

interface SpawnOptions {
  cwd: string;
  env: Record<string, string | undefined>;
}

interface TerminalResult {
  exitCode: number;
  output: string;
}

export const spawnTerminal = async (
  argv: string[],
  options: SpawnOptions,
  onOutput?: (output: string, terminal: Bun.Terminal) => void,
): Promise<TerminalResult> => {
  const decoder = new TextDecoder();
  let output = "";
  const child = Bun.spawn(argv, {
    ...options,
    terminal: {
      data(terminal, data) {
        output += decoder.decode(data, { stream: true });
        onOutput?.(output, terminal);
      },
    },
  });
  const exitCode = await child.exited;
  child.terminal?.close();
  return { exitCode, output: output + decoder.decode() };
};

// A terminal merges stdout and stderr, so the result carries both in stdout.
export const terminalRunner =
  (home: string): RunTerminal =>
  async (cwd, answers, ...args) => {
    let next = 0;
    let searchFrom = 0;
    const { exitCode, output } = await spawnTerminal(
      [process.execPath, cli, ...args],
      { cwd, env: cliEnv(home) },
      (sofar, terminal) => {
        const answer = answers[next];
        if (!answer) return;
        const at = sofar.indexOf(answer.on, searchFrom);
        if (at === -1) return;
        next++;
        searchFrom = at + answer.on.length;
        terminal.write(answer.send);
      },
    );
    const unanswered = answers[next];
    if (unanswered) throw new Error(`no prompt "${unanswered.on}" in:\n${output}`);
    return { exitCode, stdout: output, stderr: "" };
  };

export const makeSkill = async (
  root: string,
  name: string,
  body = `# ${name}\n`,
): Promise<void> => {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: test\n---\n${body}`);
};

export const recordedLock = (source: string, ...names: string[]): Lockfile => {
  const lock = emptyLock();
  for (const name of names) {
    lock.skills[name] = {
      source,
      path: name,
      integrity: "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      track: "auto",
    };
  }
  return lock;
};

export const initRepo = async (repo: string): Promise<void> => {
  await $`git -C ${repo} init -q -b main --template=`.quiet();
};

export const commitAll = async (repo: string, message: string): Promise<string> => {
  await $`git -C ${repo} add -A`.quiet();
  await $`git -C ${repo} -c commit.gpgsign=false -c user.email=test@example.com -c user.name=test commit -q -m ${message}`.quiet();
  return (await $`git -C ${repo} rev-parse HEAD`.text()).trim();
};

export const tagHead = async (repo: string, name: string): Promise<void> => {
  await $`git -C ${repo} -c tag.gpgSign=false -c tag.forceSignAnnotated=false tag ${name}`.quiet();
};
