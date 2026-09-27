import type { Case } from "../test-fixture.ts";

export default [
  {
    name: "inline commands in SKILL.md",
    path: "SKILL.md",
    content: "## Context\n\n- diff: !`git diff HEAD`\n- log: !`git log -1`\n",
    fire: [
      { severity: "critical", line: 3, detail: "git diff HEAD" },
      { severity: "critical", line: 4, detail: "git log -1" },
    ],
  },
  {
    name: "a `!` fence, one finding per command",
    path: "SKILL.md",
    content: "before\n```!bash\n# a comment runs nothing\ngit status\n\nwhoami\n```\n",
    fire: [
      { severity: "critical", line: 4, detail: "git status" },
      { severity: "critical", line: 6, detail: "whoami" },
    ],
  },
  {
    name: "inline command outside SKILL.md",
    path: "rules/extra.md",
    content: "see !`whoami`\n",
    fire: [{ severity: "info", line: 1, detail: "whoami" }],
  },
  {
    name: "a `!` after a character is literal",
    path: "SKILL.md",
    content: "KEY=!`whoami`\n",
    silent: "none",
  },
  {
    name: "an ordinary shell fence",
    path: "SKILL.md",
    content: "```bash\ngit status\n```\n",
    silent: "none",
  },
] satisfies Case[];
