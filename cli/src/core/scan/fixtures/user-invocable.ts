import { frontmatter, type Case } from "../test-fixture.ts";

export default [
  {
    name: "hidden from the user, callable by the model",
    path: "SKILL.md",
    content: frontmatter("name: x", "user-invocable: false"),
    fire: [{ severity: "warn" }],
  },
  {
    name: "hidden from both",
    path: "SKILL.md",
    content: frontmatter("name: x", "user-invocable: false", "disable-model-invocation: true"),
    silent: "none",
  },
  {
    name: "visible to the user",
    path: "SKILL.md",
    content: frontmatter("name: x", "user-invocable: true"),
    silent: "none",
  },
] satisfies Case[];
