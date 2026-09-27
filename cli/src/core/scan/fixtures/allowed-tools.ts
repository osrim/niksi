import { frontmatter, type Case } from "../test-fixture.ts";

export default [
  {
    name: "unscoped Bash",
    path: "SKILL.md",
    content: frontmatter("name: x", "allowed-tools: Bash"),
    fire: [{ severity: "critical", detail: "Bash" }],
  },
  {
    name: "Bash with a wildcard scope",
    path: "SKILL.md",
    content: frontmatter("name: x", "allowed-tools: Bash(*:*)"),
    fire: [{ severity: "critical", detail: "Bash(*:*)" }],
  },
  {
    name: "scoped grants, one finding each",
    path: "SKILL.md",
    content: frontmatter("name: x", "allowed-tools: Bash(git diff:*) Bash(git status:*), Read"),
    fire: [
      { severity: "warn", detail: "Bash(git diff:*)" },
      { severity: "warn", detail: "Bash(git status:*)" },
      { severity: "warn", detail: "Read" },
    ],
  },
  {
    name: "a list keeps its items apart",
    path: "SKILL.md",
    content: frontmatter("name: x", "allowed-tools:", "  - Bash", "  - Read"),
    fire: [
      { severity: "critical", detail: "Bash" },
      { severity: "warn", detail: "Read" },
    ],
  },
  {
    name: "no grants",
    path: "SKILL.md",
    content: frontmatter("name: x", "description: y"),
    silent: "none",
  },
  {
    name: "grants outside SKILL.md",
    path: "agents/reviewer.md",
    content: frontmatter("name: reviewer", "allowed-tools: Bash"),
    silent: "none",
  },
] satisfies Case[];
