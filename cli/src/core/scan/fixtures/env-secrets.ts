import { entry, type Case } from "../test-fixture.ts";

export default [
  {
    name: "reads a token from process.env",
    path: "scripts/run.js",
    content: "const token = process.env.API_TOKEN;\n",
    fire: [{ severity: "warn", line: 1 }],
  },
  {
    name: "reads a token from os.environ",
    path: "scripts/run.py",
    content: 'import os\ntoken = os.environ["API_TOKEN"]\n',
    fire: [{ severity: "warn", line: 2 }],
  },
  {
    name: "environment in prose",
    path: "SKILL.md",
    content: entry("Set NODE_ENV in your shell profile."),
    silent: "none",
  },
  {
    name: "F4 copy the example env file",
    path: "SKILL.md",
    content: entry("Copy `.env.example` to `.env` and fill in values."),
    silent: "warn",
    known: "F4",
  },
  {
    name: "F4 a NODE_ENV check",
    path: "scripts/setup.js",
    content: "if (process.env.NODE_ENV === 'test') {}\n",
    silent: "warn",
    known: "F4",
  },
] satisfies Case[];
