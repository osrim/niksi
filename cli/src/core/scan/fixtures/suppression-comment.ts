import { entry, type Case } from "../test-fixture.ts";

export default [
  {
    name: "a Bandit marker on a shell call",
    path: "scripts/run.py",
    content: "import subprocess\nsubprocess.call(cmd, shell=True)  # nosec B602\n",
    fire: [{ severity: "info", line: 2, detail: "# nosec" }],
  },
  {
    name: "gitleaks and detect-secrets markers in one file",
    path: "config.py",
    content: 'A = "x"  # gitleaks:allow\nB = "y"  # pragma: allowlist secret\n',
    fire: [{ severity: "info", line: 1, detail: "gitleaks:allow (2 matches)" }],
  },
  {
    name: "ShellCheck, ESLint, and flake8 markers",
    path: "scripts/setup.sh",
    content: "# shellcheck disable=SC2086\n// eslint-disable-next-line\nimport os  # noqa\n",
    fire: [{ severity: "info", line: 1, detail: "shellcheck disable= (3 matches)" }],
  },
  {
    name: "prose about security checks",
    path: "SKILL.md",
    content: entry("Run shellcheck on every script. No security exceptions."),
    silent: "none",
  },
] satisfies Case[];
