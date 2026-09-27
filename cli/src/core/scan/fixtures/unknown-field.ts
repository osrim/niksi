import { frontmatter, type Case } from "../test-fixture.ts";

export default [
  {
    name: "fields niksi has no rule for",
    path: "SKILL.md",
    content: frontmatter("name: x", "sandbox: false", "wat: 1"),
    fire: [
      { severity: "info", detail: "sandbox: false" },
      { severity: "info", detail: "wat: 1" },
    ],
  },
  {
    name: "a field with no value",
    path: "SKILL.md",
    content: frontmatter("name: x", "sandbox:"),
    fire: [{ severity: "info", detail: "sandbox" }],
  },
  {
    name: "the benign fields",
    path: "SKILL.md",
    content: frontmatter(
      "name: x",
      "description: does nothing",
      "when_to_use: never",
      "argument-hint: <path>",
      "license: MIT",
      "compatibility: claude-code",
      "metadata:",
      "  author: someone",
      "disable-model-invocation: true",
    ),
    silent: "none",
  },
  {
    name: "fields that context: fork claims",
    path: "SKILL.md",
    content: frontmatter("name: x", "context: fork", "agent: reviewer"),
    silent: "none",
  },
] satisfies Case[];
