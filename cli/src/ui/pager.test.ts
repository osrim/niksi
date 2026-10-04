import { describe, expect, test } from "bun:test";
import { MODE_FILE, MODE_SYMLINK, type SkillFile } from "../core/skill/files.ts";
import { probe } from "../test-color.ts";
import {
  escapeControl,
  numberLines,
  pagerCommand,
  renderSession,
  type Highlight,
} from "./pager.ts";

const ESC = "\u001B";

const file = (path: string, content: string | Buffer, mode = MODE_FILE): SkillFile => ({
  path,
  content: Buffer.from(content),
  mode,
});

const stub: Highlight = (path, text) => `[${path}] ${JSON.stringify(text)}`;

const plain = (text: string): string => Bun.stripANSI(text);

describe("escapeControl", () => {
  test("shows ESC, other C0 characters, and DEL as caret markers", () => {
    expect(escapeControl(`a${ESC}[31mb\u0000c\u0007d\rE\u007F`)).toBe("a^[[31mb^@c^Gd^ME^?");
  });

  test("keeps tab and newline", () => {
    expect(escapeControl("a\tb\nc")).toBe("a\tb\nc");
  });
});

describe("numberLines", () => {
  test("numbers each line of a file", () => {
    expect(plain(numberLines("x.md", "one\ntwo\n"))).toBe("   1 one\n   2 two");
  });

  test("numbers a last line without a newline", () => {
    expect(plain(numberLines("x.md", "one"))).toBe("   1 one");
  });

  test("prints nothing for an empty file", () => {
    expect(numberLines("x.md", "")).toBe("");
  });
});

describe("renderSession", () => {
  test("puts the diff first, then SKILL.md, then the other files by path", () => {
    const session = renderSession(
      [
        {
          name: "alpha",
          files: [
            file("scripts/run.sh", "echo\n"),
            file("link", "../outside", MODE_SYMLINK),
            file("SKILL.md", "---\nname: alpha\n---\n"),
            file("image.bin", Buffer.from([0x89, 0x00, 0x01])),
          ],
          diff: {
            stat: " SKILL.md | 1 +",
            patch: "diff --git a/SKILL.md b/SKILL.md\n+name: alpha\n",
          },
        },
      ],
      stub,
    );

    expect(plain(session)).toBe(
      [
        "==> alpha",
        "",
        "diff --git a/SKILL.md b/SKILL.md",
        "+name: alpha",
        "",
        "SKILL.md (20 B)",
        '[SKILL.md] "---\\nname: alpha\\n---\\n"',
        "",
        "image.bin (3 B)",
        "binary, 3 B",
        "",
        "link (symlink)",
        "→ ../outside",
        "",
        "scripts/run.sh (5 B)",
        '[scripts/run.sh] "echo\\n"',
        "",
      ].join("\n"),
    );
  });

  test("shows a text file with NUL or a UTF-16 byte-order mark as the text the scan reads", () => {
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("hi\n", "utf16le")]);
    const session = renderSession(
      [
        {
          name: "alpha",
          files: [file("SKILL.md", `cu\u0000rl ${ESC}x\n`), file("notes.md", utf16)],
        },
      ],
      stub,
    );

    expect(plain(session)).toBe(
      [
        "==> alpha",
        "",
        "SKILL.md (9 B)",
        '[SKILL.md] "curl ^[x\\n"',
        "",
        "notes.md (8 B)",
        '[notes.md] "hi\\n"',
        "",
      ].join("\n"),
    );
  });

  test("shows no diff section without a diff or with an empty patch", () => {
    const session = renderSession(
      [
        { name: "alpha", files: [file("SKILL.md", "a\n")] },
        {
          name: "beta",
          files: [file("SKILL.md", "b\n")],
          diff: { stat: "(installed content is missing; showing no diff)", patch: "" },
        },
      ],
      numberLines,
    );

    expect(plain(session)).toBe(
      [
        "==> alpha",
        "",
        "SKILL.md (2 B)",
        "   1 a",
        "",
        "==> beta",
        "",
        "SKILL.md (2 B)",
        "   1 b",
        "",
      ].join("\n"),
    );
  });

  test("escapes control characters before the highlighter and in the diff", () => {
    const session = renderSession(
      [
        {
          name: "alpha",
          files: [file("SKILL.md", `hidden${ESC}[8m text\n`), file(`bad${ESC}name`, "x")],
          diff: { stat: "", patch: `diff --git a/SKILL.md b/SKILL.md\n+${ESC}[2J\n` },
        },
      ],
      stub,
    );

    for (const injected of [`${ESC}[8m`, `${ESC}[2J`, `bad${ESC}name`]) {
      expect(session).not.toContain(injected);
    }
    expect(session).toContain("+^[[2J");
    expect(session).toContain('[SKILL.md] "hidden^[[8m text\\n"');
    expect(session).toContain("bad^[name (1 B)");
  });

  test("escapes a symlink target", () => {
    const session = renderSession(
      [{ name: "alpha", files: [file("link", `x${ESC}y`, MODE_SYMLINK)] }],
      stub,
    );
    expect(plain(session)).toContain("→ x^[y");
  });
});

describe("pagerCommand", () => {
  test("defaults to less with LESS=FRX", () => {
    expect(pagerCommand({})).toEqual({ command: "less", env: { LESS: "FRX" } });
  });

  test("uses $PAGER", () => {
    expect(pagerCommand({ PAGER: "most -s" })).toEqual({
      command: "most -s",
      env: { LESS: "FRX" },
    });
  });

  test("keeps a LESS the person set", () => {
    expect(pagerCommand({ PAGER: "less", LESS: "-S" })).toEqual({
      command: "less",
      env: { LESS: "-S" },
    });
  });

  test("treats an empty $PAGER as unset", () => {
    expect(pagerCommand({ PAGER: "" }).command).toBe("less");
  });
});

const COLOR = `
  const { colorDiff, colorStat } = await import(DIR + "/pager.ts");
  process.stdout.write(JSON.stringify({
    diff: colorDiff("@@ -1 +1 @@\\n-old\\n+new\\n context"),
    stat: colorStat(" SKILL.md | 3 ++-\\n img.png | Bin 0 -> 3 bytes\\n 2 files changed"),
    missing: colorStat("(installed content is missing; showing no diff)"),
  }));
`;

const colored = async (env: Record<string, string>) =>
  JSON.parse((await probe(env, COLOR)).join("\n")) as Record<"diff" | "stat" | "missing", string>;

describe("diff and stat color", () => {
  test("colors +, -, and @@ lines and the stat bar when color is on", async () => {
    const out = await colored({ FORCE_COLOR: "3" });
    const [hunk, removed, added, context] = out.diff.split("\n");
    expect(hunk).toContain(ESC);
    expect(removed).toContain(ESC);
    expect(added).toContain(ESC);
    expect(context).toBe(" context");
    expect(plain(out.diff)).toBe("@@ -1 +1 @@\n-old\n+new\n context");

    const [bar, binary, summary] = out.stat.split("\n");
    expect(bar).toStartWith(" SKILL.md | 3 ");
    expect(bar).toContain(ESC);
    expect(binary).toBe(" img.png | Bin 0 -> 3 bytes");
    expect(summary).toBe(" 2 files changed");
    expect(plain(out.stat)).toBe(
      " SKILL.md | 3 ++-\n img.png | Bin 0 -> 3 bytes\n 2 files changed",
    );
    expect(out.missing).toBe("(installed content is missing; showing no diff)");
  });

  test("adds no color when color is off", async () => {
    const out = await colored({ NO_COLOR: "1" });
    expect(out.diff).toBe("@@ -1 +1 @@\n-old\n+new\n context");
    expect(out.stat).toBe(" SKILL.md | 3 ++-\n img.png | Bin 0 -> 3 bytes\n 2 files changed");
  });
});
