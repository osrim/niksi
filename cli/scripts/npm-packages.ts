import { chmod, copyFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import pkg from "../package.json" with { type: "json" };

const LICENSE = join(import.meta.dir, "..", "..", "LICENSE");

// release.yml extracts niksi-<os>-<arch>.tar.gz into the matching directory before publishing.
export const PLATFORMS: readonly (readonly [os: string, arch: string])[] = [
  ["darwin", "arm64"],
  ["darwin", "x64"],
  ["linux", "x64"],
  ["linux", "arm64"],
];

const REPO = "https://github.com/osrim/niksi";
const COMMON = {
  license: "MIT",
  homepage: REPO,
  bugs: `${REPO}/issues`,
  repository: { type: "git", url: `git+${REPO}.git`, directory: "cli" },
  publishConfig: { access: "public" },
};

const platformName = (os: string, arch: string): string => `@osrim/niksi-${os}-${arch}`;

export interface Manifest {
  name: string;
  version: string;
  [field: string]: unknown;
}

export const platformPackage = (version: string, os: string, arch: string): Manifest => ({
  name: platformName(os, arch),
  version,
  description: `niksi binary for ${os}-${arch}. Install \`niksi\` instead.`,
  os: [os],
  cpu: [arch],
  files: ["nik"],
  ...COMMON,
});

export const mainPackage = (version: string): Manifest => ({
  name: "niksi",
  version,
  description: pkg.description,
  keywords: ["skills", "agents", "claude-code", "codex", "cursor", "cli"],
  type: "module",
  bin: { nik: "bin/nik.js" },
  files: ["bin", "README.md"],
  optionalDependencies: Object.fromEntries(
    PLATFORMS.map(([os, arch]) => [platformName(os, arch), version]),
  ),
  ...COMMON,
});

const README = `# niksi

\`niksi\` installs, updates, and links community skills into your coding agent. The command is \`nik\`.

\`\`\`sh
npm install -g niksi
nik --help
\`\`\`

Docs, Homebrew, and release binaries: ${REPO}
`;

const writeManifest = async (dir: string, manifest: Manifest): Promise<void> => {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await copyFile(LICENSE, join(dir, "LICENSE"));
};

export const writePackages = async (version: string, outDir: string): Promise<void> => {
  const main = join(outDir, "niksi");
  await writeManifest(main, mainPackage(version));
  await writeFile(join(main, "README.md"), README);
  await mkdir(join(main, "bin"), { recursive: true });
  const shim = join(main, "bin", "nik.js");
  await copyFile(join(import.meta.dir, "npm-shim.js"), shim);
  await chmod(shim, 0o755);
  for (const [os, arch] of PLATFORMS) {
    await writeManifest(join(outDir, `niksi-${os}-${arch}`), platformPackage(version, os, arch));
  }
};

if (import.meta.main) {
  const [version, outDir] = Bun.argv.slice(2);
  if (!version || !outDir) {
    console.error("usage: bun scripts/npm-packages.ts <version> <out-dir>");
    process.exit(2);
  }
  await writePackages(version, outDir);
}
