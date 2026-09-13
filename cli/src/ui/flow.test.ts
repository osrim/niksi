import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { linkSkill, writeCanonical } from "../core/install/link.ts";
import { emptyLock, readLock } from "../core/install/lockfile.ts";
import { ensureClone, git } from "../core/source/git.ts";
import { GitSource } from "../core/source/git-source.ts";
import { fetchSkillFiles, land } from "./flow.ts";
import { captureEnv } from "../test-env.ts";

let tmp: string;
let cwd: string;

const restoreEnv = captureEnv("SKI_HOME", "XDG_CACHE_HOME");

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "ski-flow-test-"));
  cwd = process.cwd();
  process.env.SKI_HOME = join(tmp, "ski-home");
  process.env.XDG_CACHE_HOME = join(tmp, "cache");
});

afterAll(async () => {
  process.chdir(cwd);
  restoreEnv();
  process.exitCode = 0;
  await rm(tmp, { recursive: true, force: true });
});

test("lands later items after a failure, writes the lock, and hides links", async () => {
  const root = join(tmp, "project");
  await mkdir(root, { recursive: true });
  expect((await git(["init", "--quiet"], root)).code).toBe(0);
  process.chdir(root);

  const files = [{ path: "SKILL.md", content: Buffer.from("demo\n"), mode: "100644" }];
  await writeCanonical("works", files, "project");
  await linkSkill("works", "project", "claude");

  const lock = emptyLock();
  await land({
    items: ["fails", "works"],
    name: (item) => item,
    apply: (item) => {
      if (item === "fails") return Promise.reject(new Error("nope"));
      lock.skills[item] = {
        source: "local:demo",
        path: "",
        integrity: "sha256-qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo=",
        track: "auto",
      };
      return Promise.resolve({ success: "worked" });
    },
    scope: "project",
    lock,
  });

  expect(process.exitCode).toBe(1);
  expect((await readLock("project")).skills).toEqual(lock.skills);
  expect(await readFile(join(root, ".git", "info", "exclude"), "utf8")).toContain(
    ".claude/skills/works",
  );
  process.exitCode = 0;
});

test("fetches a batch of many skills from one partial clone", async () => {
  const work = join(tmp, "batch-work");
  const remote = join(tmp, "batch-remote.git");
  const names = Array.from({ length: 19 }, (_, i) => `skill-${String(i).padStart(2, "0")}`);
  for (const name of names) {
    const dir = join(work, "skills", name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "SKILL.md"), `---\nname: ${name}\n---\n`);
    for (let n = 0; n < 8; n++) await writeFile(join(dir, `ref-${n}.md`), `${name} ${n}\n`);
  }
  const big = Buffer.alloc(300_000, 7);
  await writeFile(join(work, "skills", names[0]!, "big.bin"), big);
  await $`git -C ${work} init -q -b main`.quiet();
  await $`git -C ${work} add -A`.quiet();
  await $`git -C ${work} -c commit.gpgsign=false -c user.email=t@t -c user.name=t commit -q -m batch`.quiet();
  await $`git init -q --bare -b main ${remote}`.quiet();
  await $`git -C ${remote} config uploadpack.allowFilter true`.quiet();
  await $`git -C ${work} push -q ${remote} main`.quiet();

  const source = new GitSource(`file://${remote}`);
  const clone = await ensureClone(source.id);
  expect((await git(["config", "remote.origin.promisor"], clone)).out).toBe("true");

  const rev = await source.resolve();
  const commit = rev.commit!;
  const bigOid = (await git(["ls-tree", commit, "skills/skill-00/big.bin"], clone)).out.split(
    /\s+/u,
  )[2]!;
  const missing = (await git(["rev-list", "--objects", "--missing=print", commit], clone)).out;
  expect(missing).toContain(`?${bigOid}`);

  const skills = await source.discover(rev.commit);
  expect(skills.map((skill) => skill.name)).toEqual(names);

  const fetched = await fetchSkillFiles(source, rev.commit, skills);
  expect(fetched.map(({ files }) => files.length)).toEqual([
    10, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9,
  ]);
  expect(fetched[0]!.skill.name).toBe("skill-00");
  expect(fetched[0]!.files.find((file) => file.path === "big.bin")!.content).toEqual(big);
  expect(fetched[18]!.skill.name).toBe("skill-18");
  expect(fetched[18]!.files.find((file) => file.path === "ref-7.md")!.content.toString()).toBe(
    "skill-18 7\n",
  );
});
