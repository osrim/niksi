import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import type { AgentId } from "../core/install/agents.ts";
import { applySkill } from "../core/install/apply.ts";
import { linkSkill, writeCanonical } from "../core/install/link.ts";
import { loadLock, readLock, type LoadedLockfile } from "../core/install/lockfile.ts";
import type { SkillFile } from "../core/skill/files.ts";
import { integrityOf } from "../core/skill/integrity.ts";
import { ensureClone, git } from "../core/source/git.ts";
import { GitSource } from "../core/source/git-source.ts";
import { fetchSkillFiles, land } from "./flow.ts";
import { captureEnv } from "../test-env.ts";
import { captureOutput } from "../test-output.ts";

let tmp: string;
let cwd: string;

const restoreEnv = captureEnv("NIKSI_HOME", "XDG_CACHE_HOME");

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "niksi-flow-test-"));
  cwd = process.cwd();
  process.env.NIKSI_HOME = join(tmp, "niksi-home");
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

  const loaded = await loadLock("project");
  await land({
    items: ["fails", "works"],
    name: (item) => item,
    apply: (item) => {
      if (item === "fails") return Promise.reject(new Error("nope"));
      loaded.lock.skills[item] = {
        source: "local:demo",
        path: "",
        integrity: "sha256-qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo=",
        track: "auto",
      };
      return Promise.resolve({ success: "worked" });
    },
    scope: "project",
    lock: loaded,
  });

  expect(process.exitCode).toBe(1);
  expect((await readLock("project")).skills).toEqual(loaded.lock.skills);
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

const version = (text: string): SkillFile[] => [
  { path: "SKILL.md", content: Buffer.from(text), mode: "100644" },
];

const landCopies = async (
  items: { name: string; text: string; agents: AgentId[]; managed: AgentId[] }[],
  loaded: LoadedLockfile,
): Promise<string> => {
  const output = captureOutput();
  try {
    await land({
      items,
      name: (item) => item.name,
      apply: async ({ name, text, agents, managed }) => ({
        ...(await applySkill(
          {
            name,
            source: "local:/demo",
            path: name,
            revision: { track: "auto" },
            files: () => Promise.resolve(version(text)),
          },
          {
            kind: "agent-copy",
            scope: "project",
            agents,
            managed,
            lock: loaded.lock,
          },
        )),
        success: "copied",
      }),
      scope: "project",
      lock: loaded,
    });
  } finally {
    output.restore();
  }
  return output.text();
};

// Restores write access first so a failed assertion cannot block the temporary directory cleanup.
const unlockLeftover = async (parent: string, name: string): Promise<string | undefined> => {
  const leftover = (await readdir(parent)).find((entry) => entry.startsWith(`.${name}.`));
  if (leftover === undefined) return undefined;
  await chmod(join(parent, leftover, "old", "locked"), 0o755);
  return join(parent, leftover);
};

describe.skipIf(process.getuid?.() === 0)("land after filesystem changes", () => {
  let root: string;

  beforeAll(async () => {
    root = join(tmp, "copies");
    await mkdir(root, { recursive: true });
    expect((await git(["init", "--quiet"], root)).code).toBe(0);
    process.chdir(root);
  });

  afterEach(() => {
    process.exitCode = 0;
  });

  test("a failure after an earlier placement changed keeps the old entry and lands later items", async () => {
    const loaded = await loadLock("project");
    const both: AgentId[] = ["claude", "universal"];
    await landCopies([{ name: "broken", text: "v1\n", agents: both, managed: [] }], loaded);
    const before = (await readLock("project")).skills["broken"];
    const universal = join(root, ".agents", "skills");
    await chmod(universal, 0o555);

    const printed = await landCopies(
      [
        { name: "broken", text: "v2\n", agents: both, managed: both },
        { name: "fine", text: "v1\n", agents: ["claude"], managed: [] },
      ],
      loaded,
    ).finally(() => chmod(universal, 0o755));

    expect(process.exitCode).toBe(1);
    expect(printed).toContain("broken: ");
    const skills = (await readLock("project")).skills;
    expect(skills["broken"]).toEqual(before!);
    expect(skills["fine"]!.integrity).toBe(integrityOf(version("v1\n")));
    expect(await readFile(join(root, ".claude", "skills", "broken", "SKILL.md"), "utf8")).toBe(
      "v2\n",
    );
    expect(await readFile(join(universal, "broken", "SKILL.md"), "utf8")).toBe("v1\n");
    expect(await readFile(join(root, ".claude", "skills", "fine", "SKILL.md"), "utf8")).toBe(
      "v1\n",
    );
  });

  test("a directory left before a later placement failed is still reported", async () => {
    const loaded = await loadLock("project");
    const both: AgentId[] = ["claude", "universal"];
    await landCopies([{ name: "doubled", text: "v1\n", agents: both, managed: [] }], loaded);
    const parent = join(root, ".claude", "skills");
    const locked = join(parent, "doubled", "locked");
    await mkdir(locked);
    await writeFile(join(locked, "notes.md"), "mine\n");
    await chmod(locked, 0o555);
    const universal = join(root, ".agents", "skills");
    await chmod(universal, 0o555);

    const printed = await landCopies(
      [{ name: "doubled", text: "v2\n", agents: both, managed: both }],
      loaded,
    ).finally(() => chmod(universal, 0o755));

    const leftover = await unlockLeftover(parent, "doubled");

    expect(process.exitCode).toBe(1);
    expect(leftover).toBeDefined();
    expect(printed).toContain(leftover!);
  });

  test("a directory left after a replacement is reported and the entry is recorded", async () => {
    const loaded = await loadLock("project");
    const locked = join(root, ".claude", "skills", "fine", "locked");
    await mkdir(locked);
    await writeFile(join(locked, "notes.md"), "mine\n");
    await chmod(locked, 0o555);

    const printed = await landCopies(
      [{ name: "fine", text: "v2\n", agents: ["claude"], managed: ["claude"] }],
      loaded,
    );
    const leftover = await unlockLeftover(join(root, ".claude", "skills"), "fine");

    expect(process.exitCode).toBe(0);
    expect((await readLock("project")).skills["fine"]!.integrity).toBe(
      integrityOf(version("v2\n")),
    );
    expect(leftover).toBeDefined();
    expect(printed).toContain(leftover!);
  });
});
