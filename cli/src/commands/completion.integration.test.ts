import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { bashCompleter, writeNik } from "../core/completion/test-fixture.ts";
import { serializeLock } from "../core/install/lockfile.ts";
import { cli, cliEnv, cliRunner, recordedLock, type RunCli } from "../test-cli.ts";

let tmp: string;
let runCli: RunCli;
let project: string;

beforeAll(async () => {
  tmp = await realpath(await mkdtemp(join(tmpdir(), "niksi-completion-cli-test-")));
  runCli = cliRunner(tmp);
  project = join(tmp, "project");
  await mkdir(join(project, ".git"), { recursive: true });
  const lock = recordedLock("https://github.com/o/r", "tdd", "grilling", "pdf");
  lock.skills.pdf!.disabled = true;
  await writeFile(join(project, "niksi-lock.json"), serializeLock(lock));
  const global = join(tmp, "niksi-home");
  await mkdir(global, { recursive: true });
  await writeFile(
    join(global, "niksi-lock.json"),
    serializeLock(recordedLock("https://github.com/o/r", "codebase-design")),
  );
});

afterAll(() => rm(tmp, { recursive: true, force: true }));

const lines = (text: string): string[] => text.split("\n").filter((line) => line !== "");

test("the bash script completes real commands and skill names from the lockfile", async () => {
  const printed = await runCli(project, "completion", "bash");
  expect(printed.exitCode).toBe(0);
  const script = join(tmp, "nik.bash");
  await writeFile(script, printed.stdout);
  const bin = join(tmp, "bin");
  await writeNik(bin, `exec '${process.execPath}' '${cli}' "$@"`);
  const complete = bashCompleter(script, {
    cwd: project,
    env: { ...cliEnv(tmp), PATH: `${bin}:${process.env.PATH}` },
  });

  expect(await complete("dis")).toEqual(["disable"]);
  expect(await complete("up", "--rep")).toEqual(["--report"]);
  expect(await complete("enable", "")).toEqual(["pdf"]);
  expect(await complete("disable", "")).toEqual(["grilling", "tdd"]);
  expect(await complete("rm", "-g", "")).toEqual(["codebase-design"]);
});

test("every shell gets a script", async () => {
  for (const [shell, first] of [
    ["bash", "# bash completion for nik."],
    ["zsh", "#compdef nik"],
    ["fish", "# fish completion for nik."],
  ]) {
    const printed = await runCli(project, "completion", shell!);
    expect(printed.exitCode).toBe(0);
    expect(printed.stdout.startsWith(first!)).toBe(true);
  }
});

test("an unknown or missing shell is a usage error", async () => {
  const unknown = await runCli(project, "completion", "pwsh");
  expect(unknown.exitCode).toBe(2);
  expect(unknown.stderr).toContain("Unknown shell: pwsh");
  const missing = await runCli(project, "completion");
  expect(missing.exitCode).toBe(2);
});

test("the skills helper prints names for the scope on the command line and nothing on errors", async () => {
  const inProject = await runCli(project, "__complete-skills", "enable");
  expect(inProject.exitCode).toBe(0);
  expect(lines(inProject.stdout)).toEqual(["pdf"]);

  const global = await runCli(project, "__complete-skills", "update", "--global");
  expect(lines(global.stdout)).toEqual(["codebase-design"]);

  const broken = join(tmp, "broken");
  await mkdir(join(broken, ".git"), { recursive: true });
  await writeFile(join(broken, "niksi-lock.json"), "{ not json");
  const failed = await runCli(broken, "__complete-skills", "remove");
  expect(failed.exitCode).toBe(0);
  expect(failed.stdout).toBe("");
});
