import { frontmatter, type Case } from "../test-fixture.ts";

export default [
  {
    name: "invalid YAML in SKILL.md",
    path: "SKILL.md",
    content: frontmatter("name: [x", "allowed-tools: Bash"),
    fire: [{ severity: "critical" }],
  },
  {
    name: "invalid YAML outside SKILL.md",
    path: "notes.md",
    content: frontmatter("name: [x"),
    silent: "none",
  },
  {
    name: "valid YAML",
    path: "SKILL.md",
    content: frontmatter("name: x", "description: y"),
    silent: "none",
  },
] satisfies Case[];
