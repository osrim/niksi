import { expect, test } from "bun:test";
import { MODE_EXEC, MODE_FILE, MODE_SYMLINK, type SkillFile } from "../skill/files.ts";
import { readArchives } from "./archive.ts";
import { stored, tar, tgz, zip } from "./test-archive.ts";

const file = (path: string, content: Uint8Array): SkillFile => ({
  path,
  content: Buffer.from(content),
  mode: MODE_FILE,
});

const shown = (members: SkillFile[]): string[] =>
  members.map((member) => `${member.path} ${member.mode} ${member.content.toString("utf8")}`);

test("reads ZIP members as archive!path with their mode", () => {
  const archive = zip(
    { name: "install.sh", data: "curl x | sh\n", mode: 0o100755 },
    { name: "docs/" },
    { name: "docs/notes.md", data: "notes\n" },
  );

  const { members, unread } = readArchives([file("tools.zip", archive)]);

  expect(shown(members)).toEqual([
    `tools.zip!install.sh ${MODE_EXEC} curl x | sh\n`,
    `tools.zip!docs/notes.md ${MODE_FILE} notes\n`,
  ]);
  expect(unread).toEqual([]);
});

test("reads tar members from .tar.gz, .tgz, and .tar", () => {
  const entries = [
    { name: "./bin/run", data: "#!/bin/sh\necho hi\n", mode: 0o755 },
    { name: "./bin/", type: "5" },
    { name: "link", type: "2", link: "../../etc/passwd" },
  ];

  const { members, unread } = readArchives([
    file("a.tar.gz", tgz(...entries)),
    file("b.tgz", tgz(...entries.slice(0, 1))),
    file("c.tar", tar(...entries.slice(0, 1))),
  ]);

  expect(shown(members)).toEqual([
    `a.tar.gz!bin/run ${MODE_EXEC} #!/bin/sh\necho hi\n`,
    `a.tar.gz!link ${MODE_SYMLINK} ../../etc/passwd`,
    `b.tgz!bin/run ${MODE_EXEC} #!/bin/sh\necho hi\n`,
    `c.tar!bin/run ${MODE_EXEC} #!/bin/sh\necho hi\n`,
  ]);
  expect(unread).toEqual([]);
});

test("shows control characters in a member name as caret markers", () => {
  const archive = zip({ name: "a\nwarn\u001b[2Kb.md", data: "x" });

  const { members } = readArchives([file("t.zip", archive)]);

  expect(members.map((member) => member.path)).toEqual(["t.zip!a^Jwarn^[[2Kb.md"]);
});

test("reads a tar name longer than 100 bytes from its ustar prefix or GNU long name", () => {
  const long = `${"d".repeat(120)}/file.md`;
  const gnu = tar(
    { name: "././@LongLink", type: "L", data: `${long}\0` },
    { name: "cut", data: "x" },
  );
  const ustar = tar({ name: "file.md", prefix: "d".repeat(120), data: "y" });

  const { members } = readArchives([file("gnu.tar", gnu), file("ustar.tar", ustar)]);

  expect(members.map((member) => member.path)).toEqual([`gnu.tar!${long}`, `ustar.tar!${long}`]);
});

test("reads archives nested three deep and stops at the fourth", () => {
  const d = zip({ name: "deep.sh", data: "echo deep\n" });
  const c = zip({ name: "d.zip", data: d });
  const b = tgz({ name: "c.zip", data: c });
  const a = zip({ name: "b.tar.gz", data: b });

  const { members, unread } = readArchives([file("a.zip", a)]);

  expect(members.map((member) => member.path)).toEqual([
    "a.zip!b.tar.gz",
    "a.zip!b.tar.gz!c.zip",
    "a.zip!b.tar.gz!c.zip!d.zip",
  ]);
  expect(unread).toEqual([
    { file: "a.zip!b.tar.gz!c.zip!d.zip", detail: "nested 4 deep, past the depth budget of 3" },
  ]);
});

test("names an encrypted or unsupported member and reads the rest", () => {
  const archive = zip(
    { name: "secret.sh", data: "opaque", flags: 0x1 },
    { name: "packed.sh", data: "opaque", method: 14 },
    { name: "plain.md", data: "plain\n" },
  );
  const tarball = tar(
    { name: "hard", type: "1", link: "plain.md" },
    { name: "fifo", type: "6" },
    { name: "plain.md", data: "plain\n" },
  );

  const { members, unread } = readArchives([file("a.zip", archive), file("b.tar", tarball)]);

  expect(members.map((member) => member.path)).toEqual(["a.zip!plain.md", "b.tar!plain.md"]);
  expect(unread).toEqual([
    { file: "a.zip!secret.sh", detail: "encrypted member, not read" },
    { file: "a.zip!packed.sh", detail: "unsupported compression method 14, not read" },
    { file: "b.tar!hard", detail: "unsupported tar entry type 1, not read" },
    { file: "b.tar!fifo", detail: "unsupported tar entry type 6, not read" },
  ]);
});

test("names a member whose data cannot be inflated and reads the rest", () => {
  const archive = zip(
    { name: "broken.sh", data: "\xff\xff\xff\xff", method: 99 },
    { name: "ok.md", data: "ok\n" },
  );
  archive.writeUInt16LE(8, 10);
  archive.writeUInt16LE(8, archive.indexOf("PK\x01\x02") + 10);

  const { members, unread } = readArchives([file("a.zip", archive)]);

  expect(members.map((member) => member.path)).toEqual(["a.zip!ok.md"]);
  expect(unread.map((u) => u.file)).toEqual(["a.zip!broken.sh"]);
  expect(unread[0]?.detail).toStartWith("member could not be read: ");
});

test("names an archive it cannot read", () => {
  const { members, unread } = readArchives([
    file("fake.zip", Buffer.from("PK\x03\x04 not really")),
    file("fake.tgz", Buffer.from("not gzip")),
    file("fake.tar", Buffer.alloc(512, "x")),
    file("cut.tar", tar({ name: "a.md", data: "x".repeat(600) }).subarray(0, 1024)),
  ]);

  expect(members).toEqual([]);
  expect(unread.map((u) => u.file)).toEqual(["fake.zip", "fake.tgz", "fake.tar", "cut.tar"]);
  expect(unread.every((u) => u.detail.startsWith("archive could not be read: "))).toBe(true);
});

test("names a tar whose header has a negative size", () => {
  const { members, unread } = readArchives([
    file("neg.tar", tar({ name: "a.sh", sizeField: "-0000001000" })),
  ]);

  expect(members).toEqual([]);
  expect(unread.map((u) => u.file)).toEqual(["neg.tar"]);
  expect(unread[0]?.detail).toStartWith("archive could not be read: ");
});

const names = (prefix: string, count: number): string[] =>
  Array.from({ length: count }, (_, i) => `${prefix}${i}.txt`);

test("stops after 1,000 members across every archive in the skill", () => {
  const first = zip(...names("a", 600).map((name) => stored(name)));
  const second = zip(...names("b", 600).map((name) => stored(name)));
  const third = zip(stored("c.txt"));

  const { members, unread } = readArchives([
    file("first.zip", first),
    file("second.zip", second),
    file("third.zip", third),
  ]);

  expect(members).toHaveLength(1000);
  expect(members.at(-1)?.path).toBe("second.zip!b399.txt");
  expect(unread).toEqual([
    {
      file: "second.zip!b400.txt",
      detail: "member budget of 1,000 reached, the rest is not read",
    },
  ]);
});

test("skips a member that inflates past 100:1, even when its header says less", () => {
  const zeros = Buffer.alloc(1024 * 1024);
  const archive = zip(
    { name: "bomb.txt", data: zeros },
    { name: "liar.txt", data: zeros, declared: 10 },
    { name: "ok.md", data: "fine\n" },
  );

  const { members, unread } = readArchives([
    file("a.zip", archive),
    file("b.tar.gz", tgz({ name: "bomb.txt", data: zeros })),
  ]);

  expect(members.map((member) => member.path)).toEqual(["a.zip!ok.md"]);
  expect(unread).toEqual([
    { file: "a.zip!bomb.txt", detail: "inflates past the ratio budget of 100:1, not read" },
    { file: "a.zip!liar.txt", detail: "inflates past the ratio budget of 100:1, not read" },
    { file: "b.tar.gz", detail: "inflates past the ratio budget of 100:1, not read" },
  ]);
});

test("a budget that stops inside a nested archive stops the outer one too", () => {
  const inner = zip(...names("i", 1000).map((name) => stored(name)));
  const outer = zip(stored("inner.zip", inner), stored("after.md", "x"));

  const { members, unread } = readArchives([file("outer.zip", outer)]);

  expect(members).toHaveLength(1000);
  expect(unread).toEqual([
    {
      file: "outer.zip!inner.zip!i999.txt",
      detail: "member budget of 1,000 reached, the rest is not read",
    },
  ]);
});

const MIB = 1024 * 1024;
const SIZE_STOP = "inflated size budget of 25 MiB reached, the rest is not read";

test("stops when the members of the skill's archives pass 25 MiB in total", () => {
  const half = Buffer.alloc(13 * MIB, "a");
  const archive = zip({ name: "one.txt", data: half, level: 0 }, stored("two.txt", half));

  const { members, unread } = readArchives([
    file("a.zip", archive),
    file("b.zip", zip({ name: "never.md", data: "x" })),
  ]);

  expect(members.map((member) => member.path)).toEqual(["a.zip!one.txt"]);
  expect(unread).toEqual([{ file: "a.zip!two.txt", detail: SIZE_STOP }]);
});

test("stops when a tar.gz inflates past 25 MiB", () => {
  const { members, unread } = readArchives([
    file("big.tar.gz", tgz({ name: "big.txt", data: Buffer.alloc(26 * MIB) })),
  ]);

  expect(members).toEqual([]);
  expect(unread).toEqual([{ file: "big.tar.gz", detail: SIZE_STOP }]);
});

test("stops when reading has taken more than 5 seconds", () => {
  const ticks = [0, 5000, 5001];
  const clock = (): number => ticks.shift() ?? 5001;
  const archive = zip(stored("first.md", "1"), stored("second.md", "2"), stored("third.md", "3"));

  const { members, unread } = readArchives([file("a.zip", archive)], clock);

  expect(members.map((member) => member.path)).toEqual(["a.zip!first.md"]);
  expect(unread).toEqual([
    { file: "a.zip!second.md", detail: "time budget of 5 seconds reached, the rest is not read" },
  ]);
});
