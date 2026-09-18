import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { $ } from "bun";
import { integrityOf, integrityOfDir } from "../skill/integrity.ts";
import { captureEnv } from "../../test-env.ts";
import { GitSource } from "./git-source.ts";

let tmp: string;
let repo: string;
const LARGE_FILE = Buffer.alloc(70 * 1024, "x");
const SUPPORTING_FILE_COUNT = 70;

// niksi passes -C on every git call; the children git spawns do not.
const skiGitProcesses = async (trace: string): Promise<number> => {
  const events = (await readFile(trace, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { event?: string; argv?: string[] });
  return events.filter((event) => event.event === "start" && event.argv?.[1] === "-C").length;
};

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "niksi-git-source-test-"));
  process.env.XDG_CACHE_HOME = join(tmp, "cache");

  repo = join(tmp, "repo");
  await mkdir(join(repo, "pstack", "skills", "tdd"), { recursive: true });
  await mkdir(join(repo, "pstack", "single"), { recursive: true });
  await writeFile(join(repo, "pstack", "skills", "tdd", "SKILL.md"), "---\nname: tdd\n---\n");
  await writeFile(join(repo, "pstack", "single", "SKILL.md"), "single\n");
  await Promise.all([
    writeFile(join(repo, "pstack", "skills", "tdd", "large.bin"), LARGE_FILE),
    ...Array.from({ length: SUPPORTING_FILE_COUNT }, (_, index) =>
      writeFile(
        join(repo, "pstack", "skills", "tdd", `note-${index.toString().padStart(2, "0")}.txt`),
        `note ${index}\n`,
      ),
    ),
  ]);
  await $`git -C ${repo} init -q -b main --template=`.quiet();
  await $`git -C ${repo} config uploadpack.allowFilter true`.quiet();
  await $`git -C ${repo} add -A`.quiet();
  await $`git -C ${repo} -c commit.gpgsign=false -c user.email=t@t -c user.name=t commit -q -m init`.quiet();
  const gitlinkTarget = (await $`git -C ${repo} rev-parse HEAD`.text()).trim();
  await $`git -C ${repo} update-index --add --cacheinfo 160000,${gitlinkTarget},pstack/skills/tdd/vendor`.quiet();
  await $`git -C ${repo} -c commit.gpgsign=false -c user.email=t@t -c user.name=t commit -q -m gitlink`.quiet();
  await $`git -C ${repo} branch release/1.0`.quiet();
  await $`git -C ${repo} branch side`.quiet();
  await $`git -C ${repo} -c tag.gpgsign=false -c user.email=t@t -c user.name=t tag -a v1.2.0 -m release`.quiet();
});

afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

test("the default branch splits off the subtree without becoming a ref", async () => {
  expect(await new GitSource(repo).splitTree(["main", "pstack"])).toEqual({ dir: "pstack" });
  expect(await new GitSource(repo).splitTree(["main"])).toEqual({ dir: "" });
});

test("a topic branch is a choice, so it stays a ref", async () => {
  expect(await new GitSource(repo).splitTree(["side", "pstack"])).toEqual({
    ref: "side",
    dir: "pstack",
  });
});

test("a slashed branch is found because the longest ref wins", async () => {
  expect(await new GitSource(repo).splitTree(["release", "1.0", "pstack"])).toEqual({
    ref: "release/1.0",
    dir: "pstack",
  });
});

test("a tag splits like a branch", async () => {
  expect(await new GitSource(repo).splitTree(["v1.2.0", "pstack"])).toEqual({
    ref: "v1.2.0",
    dir: "pstack",
  });
});

test("no prefix naming a ref leaves the whole remainder as a subtree", async () => {
  expect(await new GitSource(repo).splitTree(["nope", "pstack"])).toEqual({
    dir: "nope/pstack",
  });
});

test("discovery scoped to the split subtree finds the plugin's own skills", async () => {
  const source = new GitSource(repo);
  const { ref, dir } = await source.splitTree(["side", "pstack"]);
  const rev = await source.resolve(ref);
  const skills = await source.discover(rev.commit, dir);
  expect(skills.map((s) => [s.name, s.path])).toEqual([["tdd", "pstack/skills/tdd"]]);
});

const NO_COMMIT = "git source: no commit to read";

test("a read without a commit fails instead of standing in for a revision", async () => {
  const source = new GitSource(repo);
  await expect(source.discover(undefined)).rejects.toThrow(NO_COMMIT);
  await expect(source.fetchFiles(undefined, "pstack/skills/tdd")).rejects.toThrow(NO_COMMIT);
});

test("fetching many files uses a bounded number of git processes and preserves every byte", async () => {
  const source = new GitSource(pathToFileURL(repo).href);
  const rev = await source.resolve("main");
  const fetchWithTrace = async (path: string, traceName: string) => {
    const trace = join(tmp, traceName);
    const restoreEnv = captureEnv("GIT_TRACE2_EVENT");
    process.env.GIT_TRACE2_EVENT = trace;
    try {
      const files = await source.fetchFiles(rev.commit, path);
      return { files, trace };
    } finally {
      restoreEnv();
    }
  };
  const single = await fetchWithTrace("pstack/single", "single-fetch-trace.json");
  const many = await fetchWithTrace("pstack/skills/tdd", "many-fetch-trace.json");

  // ls-tree, cat-file, prefetch, cat-file.
  expect(await skiGitProcesses(single.trace)).toBe(4);
  expect(await skiGitProcesses(many.trace)).toBe(4);
  expect(many.files).toHaveLength(SUPPORTING_FILE_COUNT + 2);
  expect(many.files.some((file) => file.path === "vendor")).toBeFalse();
  expect(many.files.find((file) => file.path === "large.bin")?.content).toEqual(LARGE_FILE);
  expect(integrityOf(many.files)).toBe(await integrityOfDir(join(repo, "pstack", "skills", "tdd")));
});

test("a source fetched once in a run is reused by later calls and other instances", async () => {
  const source = new GitSource(repo);
  const rev = await source.resolve("main");
  await source.discover(rev.commit, "pstack");
  await writeFile(join(repo, "pstack", "skills", "tdd", "notes.md"), "later\n");
  await $`git -C ${repo} add -A`.quiet();
  await $`git -C ${repo} -c commit.gpgsign=false -c user.email=t@t -c user.name=t commit -q -m later`.quiet();

  expect((await source.resolve("main")).commit).toBe(rev.commit!);
  expect((await new GitSource(repo).resolve("main")).commit).toBe(rev.commit!);
});
