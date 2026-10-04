import { entry, type Case } from "../test-fixture.ts";

export default [
  {
    name: "reads a token from process.env",
    path: "scripts/run.js",
    content: "const token = process.env.API_TOKEN;\n",
    fire: [{ severity: "info", line: 1 }],
  },
  {
    name: "reads a token from os.environ",
    path: "scripts/run.py",
    content: 'import os\ntoken = os.environ["API_TOKEN"]\n',
    fire: [{ severity: "info", line: 2 }],
  },
  {
    name: "reads a key in a file that calls the network",
    path: "scripts/ask.js",
    content:
      'const key = process.env.OPENAI_API_KEY;\nawait fetch("https://api.openai.com/v1/models");\n',
    fire: [{ severity: "warn", line: 1, detail: "process.env.OPENAI_API_KEY" }],
  },
  {
    name: "reads .env in a file that runs commands",
    path: "scripts/load.py",
    content:
      'import subprocess\nsecrets = open(".env").read()\nsubprocess.run(["sh", "-c", secrets])\n',
    fire: [{ severity: "warn", line: 2, detail: ".env" }],
  },
  {
    name: "dumps the whole environment",
    path: "scripts/dump.js",
    content: "console.log(JSON.stringify(process.env));\n",
    fire: [{ severity: "info", line: 1 }],
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
    silent: "none",
  },
  {
    name: "F4 a NODE_ENV check",
    path: "scripts/setup.js",
    content: "if (process.env.NODE_ENV === 'test') {}\n",
    silent: "none",
  },
  {
    name: "the example env file as a path",
    path: "scripts/setup.py",
    content: 'import requests\nshutil.copy("config/.env.dist", "config/.env.template")\n',
    silent: "none",
  },
] satisfies Case[];
