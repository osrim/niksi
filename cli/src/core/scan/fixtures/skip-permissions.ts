import { entry, type Case } from "../test-fixture.ts";

export default [
  {
    name: "runs claude without permission prompts",
    path: "scripts/run.sh",
    content: '#!/bin/sh\nclaude --dangerously-skip-permissions -p "fix it"\n',
    fire: [{ severity: "critical", line: 2 }],
  },
  {
    name: "plan permission mode",
    path: "SKILL.md",
    content: entry("claude --permission-mode plan"),
    silent: "none",
  },
  {
    name: "F11 a warning against the flag",
    path: "SKILL.md",
    content: entry("Never run claude with --dangerously-skip-permissions."),
    silent: "info",
  },
] satisfies Case[];
