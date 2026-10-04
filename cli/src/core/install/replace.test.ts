import { afterAll, afterEach, beforeAll, expect, mock, spyOn, test } from "bun:test";
import * as fsp from "node:fs/promises";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tildify } from "../paths.ts";
import { readDirFiles, type SkillFile } from "../skill/files.ts";
import { RecoveryError, replaceDir } from "./replace.ts";

let tmp: string;
let count = 0;

const file = (path: string, content: string, mode = "100644"): SkillFile => ({
  path,
  content: Buffer.from(content),
  mode,
});

const next: SkillFile[] = [
  file("SKILL.md", "new\n"),
  file("scripts/run.sh", "#!/bin/sh\n", "100755"),
  file("link.md", "SKILL.md", "120000"),
];

const contents = async (dir: string): Promise<Record<string, string>> =>
  Object.fromEntries(
    (await readDirFiles(dir)).map((entry) => [entry.path, `${entry.mode} ${entry.content}`]),
  );

const oldContents = { "SKILL.md": "100644 old\n", "obsolete.md": "100644 gone soon\n" };

const fixture = async (withOld = true): Promise<{ parent: string; target: string }> => {
  const parent = join(tmp, `case-${count++}`);
  const target = join(parent, "demo");
  await mkdir(parent, { recursive: true });
  if (withOld) {
    await mkdir(target);
    await writeFile(join(target, "SKILL.md"), "old\n");
    await writeFile(join(target, "obsolete.md"), "gone soon\n");
  }
  return { parent, target };
};

const realRename = fsp.rename;

const failRenamesInto = (target: string, times: number): void => {
  let failures = 0;
  spyOn(fsp, "rename").mockImplementation((from, to) => {
    if (String(to) === target && failures < times) {
      failures++;
      return Promise.reject(new Error("injected rename failure"));
    }
    return realRename(from, to);
  });
};

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "niksi-replace-test-"));
});

afterEach(() => {
  mock.restore();
});

afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

test("a replacement holds exactly the new files, with modes and symlinks", async () => {
  const { parent, target } = await fixture();

  expect(await replaceDir(target, next)).toBeUndefined();

  expect(await contents(target)).toEqual({
    "SKILL.md": "100644 new\n",
    "link.md": "120000 SKILL.md",
    "scripts/run.sh": "100755 #!/bin/sh\n",
  });
  expect(await readlink(join(target, "link.md"))).toBe("SKILL.md");
  expect(await readdir(parent)).toEqual(["demo"]);
});

test("a new install creates the directory and its parents", async () => {
  const { parent } = await fixture(false);
  const nested = join(parent, "skills", "demo");

  expect(await replaceDir(nested, next)).toBeUndefined();

  expect(Object.keys(await contents(nested))).toEqual(["SKILL.md", "link.md", "scripts/run.sh"]);
  expect(await readdir(join(parent, "skills"))).toEqual(["demo"]);
});

test("a preparation failure leaves the old directory untouched", async () => {
  const { parent, target } = await fixture();

  await expect(
    replaceDir(target, [file("a", "file\n"), file("a/b", "nested\n")]),
  ).rejects.toThrow();

  expect(await contents(target)).toEqual(oldContents);
  expect(await readdir(parent)).toEqual(["demo"]);
});

test("a failed new install leaves no partial skill", async () => {
  const { parent, target } = await fixture(false);

  await expect(
    replaceDir(target, [file("a", "file\n"), file("a/b", "nested\n")]),
  ).rejects.toThrow();
  expect(await readdir(parent)).toEqual([]);

  failRenamesInto(target, 1);
  await expect(replaceDir(target, next)).rejects.toThrow("injected rename failure");
  expect(await readdir(parent)).toEqual([]);
});

test("a failed replacement restores the old directory", async () => {
  const { parent, target } = await fixture();
  failRenamesInto(target, 1);

  await expect(replaceDir(target, next)).rejects.toThrow("injected rename failure");

  expect(await contents(target)).toEqual(oldContents);
  expect(await readdir(parent)).toEqual(["demo"]);
});

test("a failed rollback keeps the old content and names where it is", async () => {
  const { target } = await fixture();
  failRenamesInto(target, 2);

  const error = await replaceDir(target, next).catch((e: unknown) => e);

  expect(error).toBeInstanceOf(RecoveryError);
  const { recovery, message } = error as RecoveryError;
  expect(message).toContain("injected rename failure");
  expect(message).toContain(tildify(recovery));
  expect(await contents(recovery)).toEqual(oldContents);
  expect(await lstat(target).catch(() => null)).toBeNull();
});

test.skipIf(process.getuid?.() === 0)(
  "a cleanup failure keeps the installed directory and returns what it could not remove",
  async () => {
    const { parent, target } = await fixture();
    await mkdir(join(target, "locked"));
    await writeFile(join(target, "locked", "kept.md"), "kept\n");
    await chmod(join(target, "locked"), 0o555);

    const leftover = await replaceDir(target, next);

    expect(leftover).toBeDefined();
    expect(await readFile(join(target, "SKILL.md"), "utf8")).toBe("new\n");
    expect((await readdir(parent)).toSorted()).toEqual(
      [leftover!.slice(parent.length + 1), "demo"].toSorted(),
    );
    await chmod(join(leftover!, "old", "locked"), 0o755);
  },
);
