import { expect, test } from "bun:test";
import type { Finding } from "../core/scan/index.ts";
import { renderFindings } from "./report.ts";

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
