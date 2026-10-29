import { entry, type Case } from "../test-fixture.ts";

const fence = (...lines: string[]): string => entry("```sh", ...lines, "```");

const COMMIT = "4f3c2a1b0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b";

const packageJson = (dependencies: Record<string, string>): string =>
  `${JSON.stringify({ name: "tool", dependencies }, null, 2)}\n`;

export default [
  {
    name: "a pip index on a plain-HTTP IP address",
    path: "SKILL.md",
    content: fence("pip install --index-url http://45.1.2.3/simple foo"),
    fire: [{ severity: "critical", line: 6 }],
  },
  {
    name: "npm config set registry",
    path: "SKILL.md",
    content: fence("npm config set registry https://x.invalid"),
    fire: [{ severity: "critical", line: 6 }],
  },
  {
    name: "an extra index on another host",
    path: "scripts/setup.sh",
    content: "python3 -m pip install --extra-index-url=https://pkgs.x.invalid/simple foo\n",
    fire: [{ severity: "critical", line: 1 }],
  },
  {
    name: "a short -i index flag",
    path: "SKILL.md",
    content: entry("Install it with `uv pip install -i https://pkgs.x.invalid/simple foo`."),
    fire: [{ severity: "critical", line: 5 }],
  },
  {
    name: "an npm --registry flag",
    path: "SKILL.md",
    content: fence("pnpm add --registry=https://npm.x.invalid left-pad"),
    fire: [{ severity: "critical", line: 6 }],
  },
  {
    name: "PIP_INDEX_URL before a command",
    path: "SKILL.md",
    content: fence("PIP_INDEX_URL=https://pkgs.x.invalid/simple pip install foo"),
    fire: [{ severity: "critical", line: 6 }],
  },
  {
    name: "an exported npm registry variable",
    path: "scripts/env.sh",
    content: "export npm_config_registry=https://npm.x.invalid\n",
    fire: [{ severity: "critical", line: 1 }],
  },
  {
    name: "the Yarn registry, which is not the default npm host",
    path: "SKILL.md",
    content: fence("yarn config set registry https://registry.yarnpkg.com"),
    fire: [{ severity: "critical", line: 6 }],
  },
  {
    name: "curl -k",
    path: "SKILL.md",
    content: fence("curl -k https://x.invalid/tool.tgz -o tool.tgz"),
    fire: [{ severity: "warn", line: 6 }],
  },
  {
    name: "curl with -k in a flag cluster",
    path: "scripts/fetch.sh",
    content: "curl -fsSLk https://x.invalid/tool.tgz -o tool.tgz\n",
    fire: [{ severity: "warn", line: 1 }],
  },
  {
    name: "wget --no-check-certificate",
    path: "SKILL.md",
    content: fence("wget --no-check-certificate https://x.invalid/tool.tgz"),
    fire: [{ severity: "warn", line: 6 }],
  },
  {
    name: "a trusted host",
    path: "SKILL.md",
    content: fence("pip install --trusted-host pkgs.x.invalid foo"),
    fire: [{ severity: "warn", line: 6 }],
  },
  {
    name: "find-links",
    path: "SKILL.md",
    content: fence("pip install --find-links https://x.invalid/wheels/ foo"),
    fire: [{ severity: "warn", line: 6 }],
  },
  {
    name: "an unpinned git install",
    path: "SKILL.md",
    content: fence("pip install git+https://github.com/org/repo"),
    fire: [{ severity: "warn", line: 6 }],
  },
  {
    name: "a direct URL reference",
    path: "SKILL.md",
    content: fence('pip install "tool @ https://x.invalid/tool-1.0.tar.gz"'),
    fire: [{ severity: "warn", line: 6 }],
  },
  {
    name: "an npm tarball URL",
    path: "SKILL.md",
    content: fence("npm install https://x.invalid/tool-1.0.0.tgz"),
    fire: [{ severity: "warn", line: 6 }],
  },
  {
    name: "a GitHub dependency in package.json",
    path: "package.json",
    content: packageJson({ tool: "github:org/tool" }),
    fire: [{ severity: "warn", line: 4 }],
  },
  {
    name: "a tarball dependency in package.json",
    path: "tools/package.json",
    content: packageJson({ left: "^1.0.0", tool: "https://x.invalid/tool-1.0.0.tgz" }),
    fire: [{ severity: "warn", line: 5 }],
  },
  {
    name: "an index override in references/",
    path: "references/install.md",
    content: "Install it with `pip install --index-url https://pkgs.x.invalid/simple foo`.\n",
    fire: [{ severity: "warn", line: 1 }],
  },
  {
    name: "an index override in a script comment",
    path: "scripts/setup.sh",
    content: "# pip install --index-url https://pkgs.x.invalid/simple foo\n",
    fire: [{ severity: "warn", line: 1 }],
  },
  {
    name: "curl -k after a prohibition",
    path: "SKILL.md",
    content: entry("Never run `curl -k https://x.invalid/tool.tgz` on a shared host."),
    fire: [{ severity: "info", line: 5 }],
  },
  {
    name: "a version range from the default index",
    path: "SKILL.md",
    content: fence('pip install "requests>=2.31"'),
    silent: "none",
  },
  {
    name: "a git install pinned to a commit",
    path: "SKILL.md",
    content: fence(`pip install git+https://github.com/org/repo@${COMMIT}`),
    silent: "info",
  },
  {
    name: "an npm git dependency pinned to a commit",
    path: "package.json",
    content: packageJson({ tool: `git+https://github.com/org/tool.git#${COMMIT}` }),
    silent: "info",
  },
  {
    name: "the default pip index",
    path: "SKILL.md",
    content: fence("pip install --index-url https://pypi.org/simple foo"),
    silent: "none",
  },
  {
    name: "the default npm registry",
    path: "SKILL.md",
    content: fence("npm config set registry https://registry.npmjs.org/"),
    silent: "none",
  },
  {
    name: "curl without -k",
    path: "SKILL.md",
    content: fence("curl -fsSL https://x.invalid/tool.tgz -o tool.tgz"),
    silent: "none",
  },
  {
    name: "a requirements file and a local package",
    path: "SKILL.md",
    content: fence("pip install -r requirements.txt", "npm install ./tools/helper"),
    silent: "none",
  },
  {
    name: "semver dependencies in package.json",
    path: "package.json",
    content: packageJson({ react: "^18.2.0", "@scope/tool": "1.2.3" }),
    silent: "none",
  },
  {
    name: "an index URL named in a sentence",
    path: "SKILL.md",
    content: entry("pip reads PIP_INDEX_URL when it is set; this skill never sets it."),
    silent: "none",
  },
] satisfies Case[];
