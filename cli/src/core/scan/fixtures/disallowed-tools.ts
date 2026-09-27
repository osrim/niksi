import { frontmatter, type Case } from "../test-fixture.ts";

export default [
  {
    name: "one finding per tool removed",
    path: "SKILL.md",
    content: frontmatter("name: x", "disallowed-tools:", "  - Read", "  - Grep"),
    fire: [
      { severity: "warn", detail: "Read" },
      { severity: "warn", detail: "Grep" },
    ],
  },
  {
    name: "outside SKILL.md",
    path: "agents/reviewer.md",
    content: frontmatter("name: reviewer", "disallowed-tools: Read"),
    silent: "none",
  },
] satisfies Case[];
