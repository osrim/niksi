import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bashScript } from "./bash.ts";
import { completionSpec } from "./spec.ts";
import { bashCompleter, fixtureCli, stubNik } from "./test-fixture.ts";

let tmp: string;
let stub: { bin: string; argsFile: string };
let script: string;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "nik-bash-"));
  stub = await stubNik(tmp);
  script = join(tmp, "nik.bash");
  await writeFile(script, bashScript(completionSpec(fixtureCli())));
  await mkdir(join(tmp, "skills-dir"));
  await writeFile(join(tmp, "skills-file"), "");
  complete = bashCompleter(script, {
    cwd: tmp,
    env: { ...process.env, PATH: `${stub.bin}:${process.env.PATH}` },
  });
});

afterAll(() => rm(tmp, { recursive: true, force: true }));

let complete: (...words: string[]) => Promise<string[]>;

test("completes command names and root flags", async () => {
  expect(await complete("")).toEqual(["add", "remove", "completion", "prune"]);
  expect(await complete("pr")).toEqual(["prune"]);
  expect(await complete("--v")).toEqual(["--version"]);
});

test("completes a command's flags, including help", async () => {
  expect(await complete("add", "--")).toEqual([
    "--global",
    "--agent",
    "--path",
    "--report",
    "--help",
  ]);
  expect(await complete("rm", "-")).toEqual(["-g", "--global", "-h", "--help"]);
});

test("completes agent ids after --agent and paths after a file flag", async () => {
  expect(await complete("add", "x", "--agent", "qw")).toEqual(["qwen"]);
  expect(await complete("add", "x", "--path", "skills-")).toEqual(["skills-dir"]);
  expect((await complete("add", "x", "--report", "skills-")).toSorted()).toEqual([
    "skills-dir",
    "skills-file",
  ]);
});

test("asks nik for skill names with the canonical command and the words typed after it", async () => {
  expect(await complete("rm", "-g", "grilling", "")).toEqual(["grilling", "tdd"]);
  expect((await readFile(stub.argsFile, "utf8")).split("\n")).toEqual([
    "__complete-skills",
    "remove",
    "-g",
    "grilling",
    "",
  ]);
  expect(await complete("remove", "t")).toEqual(["tdd"]);
});

test("completes shells, files for a coordinate, and nothing where no argument fits", async () => {
  expect(await complete("completion", "")).toEqual(["bash", "zsh", "fish"]);
  expect((await complete("add", "skills-")).toSorted()).toEqual(["skills-dir", "skills-file"]);
  expect(await complete("prune", "")).toEqual([]);
});
