import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const cli = join(import.meta.dir, "index.ts");

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type RunCli = (cwd: string, ...args: string[]) => Promise<RunResult>;

export const cliRunner =
  (home: string): RunCli =>
  async (cwd, ...args) => {
    const child = Bun.spawn([process.execPath, cli, ...args], {
      cwd,
      env: {
        ...process.env,
        HOME: home,
        NIKSI_HOME: join(home, "niksi-home"),
        CI: "1",
        NO_COLOR: "1",
        TERM: "dumb",
      },
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

export const makeSkill = async (
  root: string,
  name: string,
  body = `# ${name}\n`,
): Promise<void> => {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: test\n---\n${body}`);
};
