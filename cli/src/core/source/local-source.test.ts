import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalSource } from "./local-source.ts";
import { MODE_EXEC, MODE_FILE } from "../skill/files.ts";

let tmp: string;

beforeAll(async () => {
  tmp = await realpath(await mkdtemp(join(tmpdir(), "niksi-local-source-test-")));
  await mkdir(join(tmp, "repo", "skills", "demo"), { recursive: true });
  await writeFile(join(tmp, "repo", "skills", "demo", "SKILL.md"), "---\nname: demo\n---\n");
  await writeFile(join(tmp, "repo", "skills", "demo", "run.sh"), "#!/bin/sh\n");
  await chmod(join(tmp, "repo", "skills", "demo", "run.sh"), 0o755);
  await mkdir(join(tmp, "empty"));
  await writeFile(join(tmp, "file.md"), "not a directory\n");
});

afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

test("the id is the local: prefix and the directory unless one is given", () => {
  expect(new LocalSource("/work/skills").id).toBe("local:/work/skills");
  expect(new LocalSource("/work/skills", "local:./skills").id).toBe("local:./skills");
  expect(new LocalSource("/work/skills").display).toBe("/work/skills");
});

test("resolve names a missing directory, a file, and an empty directory", async () => {
  await expect(new LocalSource(join(tmp, "nope")).resolve()).rejects.toThrow(
    `no such directory: ${join(tmp, "nope")}`,
  );
  await expect(new LocalSource(join(tmp, "file.md")).resolve()).rejects.toThrow(
    `not a directory: ${join(tmp, "file.md")}`,
  );
  await expect(new LocalSource(join(tmp, "empty")).resolve()).rejects.toThrow(
    `${join(tmp, "empty")} is empty`,
  );
});

test("fetchFiles reads one skill below the source with its file modes", async () => {
  const files = await new LocalSource(join(tmp, "repo")).fetchFiles(undefined, "skills/demo");

  expect(files.map(({ path, mode }) => ({ path, mode }))).toEqual([
    { path: "SKILL.md", mode: MODE_FILE },
    { path: "run.sh", mode: MODE_EXEC },
  ]);
});

test("fetchFiles names a skill path that is not there", async () => {
  await expect(
    new LocalSource(join(tmp, "repo")).fetchFiles(undefined, "skills/ghost"),
  ).rejects.toThrow(`no such directory: ${join(tmp, "repo", "skills", "ghost")}`);
});

test("splitTree joins every segment into the skill directory", async () => {
  expect(await new LocalSource(join(tmp, "repo")).splitTree(["skills", "demo"])).toEqual({
    dir: "skills/demo",
  });
});

test("changes shows no diff when the installed content is missing", async () => {
  const changes = await new LocalSource(join(tmp, "repo")).changes(
    {
      name: "demo",
      source: "local:./repo",
      path: "skills/demo",
      integrity: "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      track: "auto",
    },
    undefined,
    join(tmp, "missing-store-entry"),
  );

  expect(changes).toEqual({
    stat: "(installed content is missing; showing no diff)",
    patch: "",
  });
});
