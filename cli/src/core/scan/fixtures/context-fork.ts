import { frontmatter, type Case } from "../test-fixture.ts";

export default [
  {
    name: "forks into a named agent",
    path: "SKILL.md",
    content: frontmatter("name: x", "context: fork", "agent: reviewer", "background: true"),
    fire: [{ severity: "warn", detail: "context: fork (agent: reviewer, background: true)" }],
  },
  {
    name: "another context value",
    path: "SKILL.md",
    content: frontmatter("name: x", "context: inline"),
    silent: "none",
  },
] satisfies Case[];
