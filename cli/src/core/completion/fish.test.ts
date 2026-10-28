import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fishScript } from "./fish.ts";
import { fixtureSpec, stubNik } from "./test-fixture.ts";

let tmp: string;
let stub: { bin: string; argsFile: string };
let script: string;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "nik-fish-"));
  stub = await stubNik(tmp);
  script = join(tmp, "nik.fish");
  await writeFile(script, fishScript(fixtureSpec));
  await mkdir(join(tmp, "skills-dir"));
  await writeFile(join(tmp, "skills-file"), "");
});

afterAll(() => rm(tmp, { recursive: true, force: true }));

const complete = async (line: string): Promise<string[]> => {
  const child = Bun.spawn(
    ["fish", "--no-config", "-c", "source $argv[1]; complete -C $argv[2]", script, line],
    {
      cwd: tmp,
      env: { ...process.env, PATH: `${stub.bin}:${process.env.PATH}` },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(stderr).toBe("");
  return stdout
    .split("\n")
    .filter((candidate) => candidate !== "")
    .map((candidate) => candidate.split("\t")[0]!)
    .toSorted();
};

const hasFish = Boolean(Bun.which("fish"));

test.skipIf(!hasFish)("completes command names and root flags", async () => {
  expect(await complete("nik ")).toEqual(["add", "completion", "prune", "remove"]);
  expect(await complete("nik --v")).toEqual(["--version"]);
});

test.skipIf(!hasFish)("completes a command's flags and their values", async () => {
  expect(await complete("nik rm --")).toEqual(["--global", "--help"]);
  expect(await complete("nik add x --agent qw")).toEqual(["qwen"]);
  expect(await complete("nik add x --path skills-")).toEqual(["skills-dir/", "skills-file"]);
  expect(await complete("nik add x --report skills-")).toEqual(["skills-dir/", "skills-file"]);
});

test.skipIf(!hasFish)(
  "asks nik for skill names with the words typed after the command",
  async () => {
    expect(await complete("nik rm -g ")).toEqual(["grilling", "tdd", "the writing whip"]);
    expect((await readFile(stub.argsFile, "utf8")).split("\n")).toEqual([
      "__complete-skills",
      "remove",
      "-g",
      "",
    ]);
  },
);

test.skipIf(!hasFish)(
  "passes scope flags typed before the command to the skills helper",
  async () => {
    await complete("nik -g rm ");
    expect((await readFile(stub.argsFile, "utf8")).split("\n")).toEqual([
      "__complete-skills",
      "remove",
      "-g",
      "",
    ]);
    await complete("nik rm ");
    expect((await readFile(stub.argsFile, "utf8")).split("\n")).toEqual([
      "__complete-skills",
      "remove",
      "",
    ]);
  },
);

test.skipIf(!hasFish)(
  "completes shells, files for a coordinate, and nothing for prune",
  async () => {
    expect(await complete("nik completion ")).toEqual(["bash", "fish", "zsh"]);
    expect(await complete("nik add skills-")).toEqual(["skills-dir/", "skills-file"]);
    expect(await complete("nik prune ")).toEqual([]);
  },
);
