import { frontmatter, type Case } from "../test-fixture.ts";

export default [
  {
    name: "one finding per field",
    path: "SKILL.md",
    content: frontmatter(
      "name: x",
      "model: claude-opus-5",
      "effort: high",
      "paths: src/**",
      "shell: zsh",
    ),
    fire: [
      { severity: "info", detail: "model: claude-opus-5" },
      { severity: "info", detail: "effort: high" },
      { severity: "info", detail: "paths: src/**" },
      { severity: "info", detail: "shell: zsh" },
    ],
  },
  {
    name: "outside SKILL.md",
    path: "agents/reviewer.md",
    content: frontmatter("name: reviewer", "model: claude-opus-5"),
    silent: "none",
  },
] satisfies Case[];
