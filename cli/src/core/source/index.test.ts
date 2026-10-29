import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  coordinateFor,
  discoveryCoordinate,
  insideProject,
  LOCAL_PREFIX,
  resolveCoordinate,
  sameSkill,
  scopeCoordinate,
  sourceFor,
  sourceForCoordinate,
  sourceMatches,
} from "./index.ts";
import { readDirFiles } from "../skill/files.ts";
import { integrityOf } from "../skill/integrity.ts";
import { materialize } from "../install/store.ts";
import type { InstalledSkill } from "../install/destination.ts";
import { parseCoordinate } from "./coordinate.ts";
import { GitSource } from "./git-source.ts";
import { captureEnv } from "../../test-env.ts";
import { commitAll, initRepo, makeSkill } from "../../test-cli.ts";

let tmp: string;
let dir: string;
const restoreEnv = captureEnv("NIKSI_HOME", "XDG_CACHE_HOME");

const installed = (
  name: string,
  path: string,
  integrity: string,
  source = dir,
): InstalledSkill => ({
  name,
  source,
  path,
  integrity,
  track: "auto",
});

beforeAll(async () => {
  tmp = await realpath(await mkdtemp(join(tmpdir(), "niksi-source-test-")));
  process.env.NIKSI_HOME = join(tmp, "niksi-home");
  process.env.XDG_CACHE_HOME = join(tmp, "cache");
  dir = join(tmp, "workspace");
  await mkdir(join(dir, "skills", "alpha"), { recursive: true });
  await mkdir(join(dir, "skills", "beta"), { recursive: true });
  await writeFile(join(dir, "skills", "alpha", "SKILL.md"), "---\nname: alpha\n---\nv1\n");
  await writeFile(join(dir, "skills", "beta", "SKILL.md"), "---\nname: beta\n---\nbeta\n");
});

afterAll(async () => {
  restoreEnv();
  await rm(tmp, { recursive: true, force: true });
});

test("only the local: prefix means a directory; a bare path is a clonable repo", () => {
  expect(sourceFor(`${LOCAL_PREFIX}/tmp/x`).kind).toBe("local");
  expect(sourceFor(`${LOCAL_PREFIX}./x`).kind).toBe("local");
  expect(sourceFor("/tmp/x").kind).toBe("git");
  expect(sourceFor("https://github.com/o/r").kind).toBe("git");
  expect(sourceFor("git@github.com:o/r").kind).toBe("git");
});

test("sourceForCoordinate follows the syntax the user typed", () => {
  expect(sourceForCoordinate({ repo: "/tmp/x", kind: "local" }).kind).toBe("local");
  expect(sourceForCoordinate({ repo: "file:///tmp/x", kind: "git" }).kind).toBe("git");
});

test("a local source discovers the same layouts a repo does", async () => {
  const skills = await sourceForCoordinate({ repo: dir, kind: "local" }).discover(undefined);
  expect(skills.map((s) => s.name)).toEqual(["alpha", "beta"]);
  expect(skills.find((s) => s.name === "alpha")!.path).toBe("skills/alpha");
});

test("a directory resolves to a revision with neither commit nor branch", async () => {
  const source = sourceForCoordinate({ repo: dir, kind: "local" });
  expect(await source.resolve()).toEqual({ track: "auto" });
});

test("each skill is pinned by its own files, so a sibling edit leaves it alone", async () => {
  const source = sourceForCoordinate({ repo: dir, kind: "local" });
  const alphaIntegrity = integrityOf(await source.fetchFiles(undefined, "skills/alpha"));
  const betaIntegrity = integrityOf(await source.fetchFiles(undefined, "skills/beta"));
  expect(alphaIntegrity).not.toBe(betaIntegrity);

  const alpha = installed("alpha", "skills/alpha", alphaIntegrity);
  const beta = installed("beta", "skills/beta", betaIntegrity);
  expect((await source.upstream(alpha)).outdated).toBe(false);

  await writeFile(join(dir, "skills", "alpha", "SKILL.md"), "---\nname: alpha\n---\nv2\n");
  const moved = await source.upstream(alpha);
  expect(moved.outdated).toBe(true);
  expect(moved.revision).toEqual({ track: "auto" });
  expect((await source.upstream(beta)).outdated).toBe(false);
});

test("an emptied skill directory reports gone, not outdated", async () => {
  const source = sourceForCoordinate({ repo: dir, kind: "local" });
  await mkdir(join(dir, "skills", "hollow"), { recursive: true });
  const r = await source.upstream(
    installed("hollow", "skills/hollow", "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="),
  );
  expect(r.gone).toBe(true);
  expect(r.outdated).toBe(false);
});

test("a deleted skill directory reports gone, not an error", async () => {
  const source = sourceForCoordinate({ repo: dir, kind: "local" });
  const r = await source.upstream(
    installed("ghost", "skills/ghost", "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="),
  );
  expect(r.gone).toBe(true);
  expect(r.outdated).toBe(false);
});

test("local changes diff the installed store entry against the directory", async () => {
  const source = sourceForCoordinate({ repo: dir, kind: "local" });
  const before = await readDirFiles(join(dir, "skills", "beta"));
  const { entry, integrity } = await materialize(source.id, "beta", before);

  await writeFile(join(dir, "skills", "beta", "SKILL.md"), "---\nname: beta\n---\nedited\n");
  await writeFile(join(dir, "skills", "beta", "extra.md"), "new file\n");

  const changes = await source.changes(
    installed("beta", "skills/beta", integrity, source.id),
    undefined,
    entry,
  );
  expect(changes.patch).toContain("-beta");
  expect(changes.patch).toContain("+edited");
});

test("insideProject holds for the root and its children, not for siblings, parents, or symlinks out", async () => {
  await mkdir(join(tmp, "elsewhere"), { recursive: true });
  await symlink(join(tmp, "elsewhere"), join(dir, "escape"));
  const prev = process.cwd();
  process.chdir(dir);
  try {
    expect(insideProject(join(dir, "escape"))).toBe(false);
    expect(insideProject(join(dir, "skills", "alpha"))).toBe(true);
    expect(insideProject(dir)).toBe(true);
    expect(insideProject(join(dir, "..hidden"))).toBe(true);
    expect(insideProject(join(tmp, "elsewhere"))).toBe(false);
    expect(insideProject(tmp)).toBe(false);
  } finally {
    process.chdir(prev);
  }
});

const inProject = async <T>(run: () => Promise<T> | T): Promise<T> => {
  const prev = process.cwd();
  process.chdir(dir);
  try {
    return await run();
  } finally {
    process.chdir(prev);
  }
};

const scoped = async (typed: string, scope: "project" | "global") => {
  const source = sourceForCoordinate({ repo: typed, kind: "local" });
  const found = await resolveCoordinate(source, { repo: typed, kind: "local" });
  return scopeCoordinate(source, scope, { root: found.dir, skills: found.skills });
};

test("both coordinates for one project skill scope to one source id and path", async () => {
  const [skillDir, parentDir] = await inProject(() =>
    Promise.all([
      scoped(join(dir, "skills", "alpha"), "project"),
      scoped(join(dir, "skills"), "project"),
    ]),
  );

  expect(skillDir.source.id).toBe(`${LOCAL_PREFIX}.`);
  expect(skillDir.root).toBe("skills/alpha");
  expect(skillDir.skills.map(({ name, path }) => ({ name, path }))).toEqual([
    { name: "alpha", path: "skills/alpha" },
  ]);
  expect(parentDir.source.id).toBe(`${LOCAL_PREFIX}.`);
  expect(parentDir.root).toBe("skills");
  expect(parentDir.skills.map(({ name, path }) => ({ name, path }))).toEqual([
    { name: "alpha", path: "skills/alpha" },
    { name: "beta", path: "skills/beta" },
  ]);
  expect(await parentDir.source.fetchFiles(undefined, "skills/alpha")).toEqual(
    await readDirFiles(join(dir, "skills", "alpha")),
  );
});

test("the project root itself scopes to an empty discovery root", async () => {
  const result = await inProject(() => scoped(dir, "project"));

  expect(result.source.id).toBe(`${LOCAL_PREFIX}.`);
  expect(result.root).toBe("");
  expect(result.skills.map((skill) => skill.path)).toEqual(["skills/alpha", "skills/beta"]);
});

test("global scope and directories outside the project anchor at the filesystem root", async () => {
  const absolute = join(dir, "skills").slice(1);
  for (const result of [
    await inProject(() => scoped(join(dir, "skills", "alpha"), "global")),
    await scoped(join(dir, "skills", "alpha"), "project"),
  ]) {
    expect(result.source.id).toBe(`${LOCAL_PREFIX}/`);
    expect(result.root).toBe(`${absolute}/alpha`);
    expect(result.skills.map((skill) => skill.path)).toEqual([`${absolute}/alpha`]);
  }
  const parent = await inProject(() => scoped(join(dir, "skills"), "global"));
  expect(parent.source.id).toBe(`${LOCAL_PREFIX}/`);
  expect(parent.root).toBe(absolute);
  expect(parent.skills.map((skill) => skill.path)).toEqual([
    `${absolute}/alpha`,
    `${absolute}/beta`,
  ]);
});

test("sameSkill compares local skills by directory and remote skills by source and path", async () => {
  await inProject(() => {
    const anchored = { source: `${LOCAL_PREFIX}.`, path: "skills/alpha" };
    expect(sameSkill(anchored, { source: `${LOCAL_PREFIX}./skills/alpha`, path: "" })).toBe(true);
    expect(sameSkill(anchored, { source: `${LOCAL_PREFIX}./skills`, path: "alpha" })).toBe(true);
    expect(
      sameSkill(anchored, { source: `${LOCAL_PREFIX}/`, path: join(dir, "skills/alpha").slice(1) }),
    ).toBe(true);
    expect(sameSkill(anchored, { source: `${LOCAL_PREFIX}.`, path: "skills/beta" })).toBe(false);
    expect(sameSkill(anchored, { source: "file:///skills/alpha", path: "" })).toBe(false);
  });
  const remote = { source: "https://github.com/o/r", path: "skills/alpha" };
  expect(sameSkill(remote, { ...remote })).toBe(true);
  expect(sameSkill(remote, { ...remote, path: "alpha" })).toBe(false);
});

test("a local coordinate selects every recorded skill in its directory, whatever the shape", async () => {
  await inProject(() => {
    const skills = parseCoordinate("./skills");
    const alpha = parseCoordinate("./skills/alpha");
    const anchored = { source: `${LOCAL_PREFIX}.`, path: "skills/alpha" };
    const old = { source: `${LOCAL_PREFIX}./skills/beta`, path: "" };
    expect(sourceMatches(anchored, skills)).toBe(true);
    expect(sourceMatches(old, skills)).toBe(true);
    expect(sourceMatches(anchored, alpha)).toBe(true);
    expect(sourceMatches(old, alpha)).toBe(false);
    expect(sourceMatches(anchored, parseCoordinate("./skills/alp"))).toBe(false);
    expect(sourceMatches({ source: "https://github.com/o/r", path: "" }, skills)).toBe(false);
  });
});

test("coordinateFor turns a recorded id back into something nik add accepts", async () => {
  await mkdir(join(dir, ".git"), { recursive: true });
  const prev = process.cwd();
  process.chdir(join(dir, "skills"));
  try {
    expect(coordinateFor(`${LOCAL_PREFIX}./skills/alpha`)).toBe(join(dir, "skills", "alpha"));
    expect(coordinateFor(`${LOCAL_PREFIX}/elsewhere/skill`)).toBe("/elsewhere/skill");
    expect(coordinateFor("https://github.com/owner/repo")).toBe("https://github.com/owner/repo");
  } finally {
    process.chdir(prev);
  }
});

test("discoveryCoordinate adds the discovery root as a forge URL that parses back to it", () => {
  const source = "https://github.com/o/r";
  expect(discoveryCoordinate({ source, branch: "main" })).toBe(source);

  const rooted = discoveryCoordinate({ source, branch: "main", root: "plugins/x" });
  expect(rooted).toBe("https://github.com/o/r/tree/main/plugins/x");
  expect(parseCoordinate(rooted!)).toEqual({
    repo: source,
    kind: "git",
    tree: ["main", "plugins", "x"],
  });

  const encoded = discoveryCoordinate({ source, branch: "release/2.x", root: "plugins/my x" });
  expect(encoded).toBe("https://github.com/o/r/tree/release/2.x/plugins/my%20x");
  expect(parseCoordinate(encoded!).tree).toEqual(["release", "2.x", "plugins", "my x"]);
});

test("a remote discovery root uses a recorded ref when the branch is absent", () => {
  const source = "https://github.com/o/r";
  const root = "plugins/x";
  const commit = "a".repeat(40);
  expect(discoveryCoordinate({ source, root, pinnedAs: "release/2", tag: "v1", commit })).toBe(
    "https://github.com/o/r/tree/release/2/plugins/x",
  );
  expect(discoveryCoordinate({ source, root, tag: "v1", commit })).toBe(
    "https://github.com/o/r/tree/v1/plugins/x",
  );
  expect(discoveryCoordinate({ source, root, commit })).toBe(
    `https://github.com/o/r/tree/${commit}/plugins/x`,
  );
  expect(discoveryCoordinate({ source, root })).toBeUndefined();
});

test("discoveryCoordinate joins the discovery root onto a local source directory", () => {
  expect(discoveryCoordinate({ source: `${LOCAL_PREFIX}/elsewhere/repo`, root: "plugins/x" })).toBe(
    "/elsewhere/repo/plugins/x",
  );
  expect(discoveryCoordinate({ source: `${LOCAL_PREFIX}/elsewhere/repo` })).toBe("/elsewhere/repo");
});

test("a coordinate path that discovery misses becomes the discovery root when it holds SKILL.md", async () => {
  const repo = join(tmp, "hidden-repo");
  await makeSkill(join(repo, "cursor/skills"), "x");
  await makeSkill(join(repo, "plugin/skills"), "x");
  await makeSkill(join(repo, ".hidden/skills"), "x");
  await makeSkill(join(repo, "tools"), "pdf");
  await mkdir(join(repo, "docs"), { recursive: true });
  await writeFile(join(repo, "docs/README.md"), "docs\n");
  await initRepo(repo);
  await commitAll(repo, "init");
  const source = new GitSource(repo);
  const resolved = async (skill: string): Promise<{ dir: string; paths: string[] }> => {
    const found = await resolveCoordinate(source, { repo, kind: "git", skill });
    return { dir: found.dir, paths: found.skills.map((s) => s.path) };
  };
  const everything = ["tools/pdf", "cursor/skills/x", "plugin/skills/x"];

  expect(await resolved(".hidden/skills/x")).toEqual({
    dir: ".hidden/skills/x",
    paths: [".hidden/skills/x"],
  });
  expect(await resolved("tools/pdf")).toEqual({ dir: "", paths: everything });
  expect(await resolved("pdf")).toEqual({ dir: "", paths: everything });
  expect(await resolved("docs")).toEqual({ dir: "", paths: everything });
  expect(await resolved(".hidden/skills")).toEqual({ dir: "", paths: everything });
});
