import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { $ } from "bun";
import { captureEnv } from "../../test-env.ts";
import type { SkillFile } from "../skill/files.ts";
import { integrityOf } from "../skill/integrity.ts";
import { GitSource } from "./git-source.ts";
import { LocalSource } from "./local-source.ts";
import { matchSkill, sameContent } from "./match.ts";

let tmp: string;
let repo: string;
let source: GitSource;
const commits: Record<string, string> = {};
const restoreEnv = captureEnv("XDG_CACHE_HOME");

const V1 = "---\nname: pdf\ndescription: Fill PDF forms.\n---\n\n# PDF\n\nVersion one.\n";
const V2 = "---\nname: pdf\ndescription: Fill PDF forms.\n---\n\n# PDF\n\nVersion two.\n";
const V3 = "---\nname: pdf\ndescription: Fill PDF forms.\n---\n\n# PDF\n\nVersion three.\n";

const LATE = "---\nname: late\ndescription: Added after the latest release.\n---\n";

const skill = (text: string): SkillFile[] => [
  { path: "SKILL.md", content: Buffer.from(text), mode: "100644" },
  { path: "run.sh", content: Buffer.from("#!/bin/sh\necho pdf\n"), mode: "100755" },
];

const commit = async (text: string, message: string): Promise<string> => {
  await writeFile(join(repo, "skills", "pdf", "SKILL.md"), text);
  await $`git -C ${repo} add -A`.quiet();
  await $`git -C ${repo} -c commit.gpgsign=false -c user.email=t@t -c user.name=t commit -q -m ${message}`.quiet();
  return (await $`git -C ${repo} rev-parse HEAD`.text()).trim();
};

const treeOf = async (rev: string): Promise<string> =>
  (await $`git -C ${repo} rev-parse ${rev}:skills/pdf`.text()).trim();

beforeAll(async () => {
  tmp = await realpath(await mkdtemp(join(tmpdir(), "niksi-match-test-")));
  process.env.XDG_CACHE_HOME = join(tmp, "cache");
  repo = join(tmp, "repo");
  await mkdir(join(repo, "skills", "pdf"), { recursive: true });
  await writeFile(join(repo, "skills", "pdf", "run.sh"), "#!/bin/sh\necho pdf\n", { mode: 0o755 });
  await $`git -C ${repo} init -q -b main --template=`.quiet();
  await $`git -C ${repo} config uploadpack.allowFilter true`.quiet();
  commits["v1"] = await commit(V1, "one");
  await $`git -C ${repo} -c tag.gpgsign=false tag v1.0.0`.quiet();
  commits["v2"] = await commit(V2, "two");
  await $`git -C ${repo} -c tag.gpgsign=false tag v2.0.0`.quiet();
  commits["v3"] = await commit(V3, "three");
  await mkdir(join(repo, "skills", "late"), { recursive: true });
  await writeFile(join(repo, "skills", "late", "SKILL.md"), LATE);
  commits["late"] = await commit(V3, "late");
  source = new GitSource(`file://${repo}`);
});

afterAll(async () => {
  restoreEnv();
  await rm(tmp, { recursive: true, force: true });
});

test("a copy of the latest release matches the revision nik add records", async () => {
  const match = await matchSkill(source, { name: "pdf", files: skill(V2), path: "skills/pdf" });
  expect(match).toEqual({
    path: "skills/pdf",
    revision: { commit: commits["v2"]!, branch: "main", track: "auto", tag: "v2.0.0" },
    files: skill(V2),
    integrity: integrityOf(skill(V2)),
  });
});

test("a copy of an older version matches the commit that wrote it", async () => {
  const match = await matchSkill(source, { name: "pdf", files: skill(V1), path: "skills/pdf" });
  expect(match?.revision).toEqual({ commit: commits["v1"]!, branch: "main", track: "auto" });
});

test("a copy of the branch head newer than the latest release matches its commit", async () => {
  const match = await matchSkill(source, { name: "pdf", files: skill(V3), path: "skills/pdf" });
  expect(match?.revision).toEqual({ commit: commits["v3"]!, branch: "main", track: "auto" });
});

test("a skill added after the latest release records the commit that holds it", async () => {
  const late: SkillFile[] = [{ path: "SKILL.md", content: Buffer.from(LATE), mode: "100644" }];
  const match = await matchSkill(source, { name: "late", files: late, path: "skills/late" });
  expect(match?.revision).toEqual({ commit: commits["late"]!, branch: "main", track: "auto" });
});

test("without a path, the skill is found by name", async () => {
  const match = await matchSkill(source, { name: "pdf", files: skill(V2) });
  expect(match?.path).toBe("skills/pdf");
});

test("without a path, a skill added after the latest release is found at the branch head", async () => {
  const late: SkillFile[] = [{ path: "SKILL.md", content: Buffer.from(LATE), mode: "100644" }];
  const match = await matchSkill(source, { name: "late", files: late });
  expect(match?.path).toBe("skills/late");
  expect(match?.revision).toEqual({ commit: commits["late"]!, branch: "main", track: "auto" });
});

test("an edited copy, or an unknown name, matches nothing", async () => {
  const edited = skill(V2.replace("two", "two, with my notes"));
  expect(await matchSkill(source, { name: "pdf", files: edited, path: "skills/pdf" })).toBe(
    undefined,
  );
  expect(await matchSkill(source, { name: "nope", files: skill(V2) })).toBeUndefined();
});

test("a pinned ref matches only the content at that ref", async () => {
  const pinned = { name: "pdf", path: "skills/pdf", pinned: "v1.0.0" };
  expect((await matchSkill(source, { ...pinned, files: skill(V1) }))?.revision).toEqual({
    commit: commits["v1"]!,
    branch: "main",
    track: "pin",
    pinnedAs: "v1.0.0",
  });
  expect(await matchSkill(source, { ...pinned, files: skill(V2) })).toBeUndefined();
});

// gh skill rewrites the frontmatter with Go's YAML encoder and adds its tracking keys.
const ghInstalled = (tree: string): string =>
  [
    "---",
    "description: Fill PDF forms.",
    "metadata:",
    "    github-path: skills/pdf",
    "    github-ref: v1.0.0",
    "    github-repo: https://github.com/acme/skills",
    `    github-tree-sha: ${tree}`,
    "name: pdf",
    "---",
    "# PDF",
    "",
    "Version one.",
    "",
  ].join("\n");

test("a gh skill copy matches its upstream files and returns them without gh metadata", async () => {
  const tree = await treeOf(commits["v1"]!);
  const local = skill(ghInstalled(tree));
  const match = await matchSkill(source, { name: "pdf", files: local, path: "skills/pdf", tree });
  expect(match?.revision).toEqual({ commit: commits["v1"]!, branch: "main", track: "auto" });
  expect(match?.files).toEqual(skill(V1));
});

test("sameContent ignores only the gh skill tracking keys and frontmatter layout", async () => {
  const tree = await treeOf(commits["v1"]!);
  expect(sameContent(skill(ghInstalled(tree)), skill(V1))).toBe(true);
  expect(sameContent(skill(ghInstalled(tree).replace("Version one", "Mine")), skill(V1))).toBe(
    false,
  );
  const extraKey = ghInstalled(tree).replace("name: pdf", "name: pdf\nlicense: MIT");
  expect(sameContent(skill(extraKey), skill(V1))).toBe(false);
  const reordered = "---\ndescription: Fill PDF forms.\nname: pdf\n---\n\n# PDF\n\nVersion one.\n";
  expect(sameContent(skill(reordered), skill(V1))).toBe(false);
  const custom = ghInstalled(tree).replace("metadata:", "metadata:\n    github-custom: mine");
  expect(sameContent(skill(custom), skill(V1))).toBe(false);
  const withoutScript = skill(ghInstalled(tree)).slice(0, 1);
  expect(sameContent(withoutScript, skill(V1))).toBe(false);
});

test("a local source matches its current files", async () => {
  const local = new LocalSource(repo);
  const match = await matchSkill(local, { name: "pdf", files: skill(V3), path: "skills/pdf" });
  expect(match).toEqual({
    path: "skills/pdf",
    revision: { track: "auto" },
    files: skill(V3),
    integrity: integrityOf(skill(V3)),
  });
  expect(await matchSkill(local, { name: "pdf", files: skill(V1) })).toBeUndefined();
});
