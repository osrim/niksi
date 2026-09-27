import { frontmatter, type Case } from "../test-fixture.ts";

export default [
  {
    name: "spaces in the name",
    path: "SKILL.md",
    content: frontmatter('name: "the writing whip"'),
    fire: [{ severity: "info", detail: "name: the writing whip" }],
  },
  {
    name: "uppercase",
    path: "SKILL.md",
    content: frontmatter("name: Uppercase"),
    fire: [{ severity: "info" }],
  },
  {
    name: "two hyphens in a row",
    path: "SKILL.md",
    content: frontmatter("name: two--hyphens"),
    fire: [{ severity: "info" }],
  },
  {
    name: "65 characters",
    path: "SKILL.md",
    content: frontmatter(`name: ${"a".repeat(65)}`),
    fire: [{ severity: "info" }],
  },
  {
    name: "a valid name",
    path: "SKILL.md",
    content: frontmatter("name: lowercase-123"),
    silent: "none",
  },
  {
    name: "64 characters",
    path: "SKILL.md",
    content: frontmatter(`name: ${"a".repeat(64)}`),
    silent: "none",
  },
  {
    name: "a name that is not a string",
    path: "SKILL.md",
    content: frontmatter("name: 123"),
    silent: "none",
  },
  {
    name: "a name with no install name",
    path: "SKILL.md",
    content: frontmatter('name: "!!!"'),
    silent: "none",
  },
  {
    name: "outside SKILL.md",
    path: "notes.md",
    content: frontmatter("name: Not Valid"),
    silent: "none",
  },
] satisfies Case[];
