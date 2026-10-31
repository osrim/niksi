import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const asset = (os: string, arch: string): string => `niksi-${os}-${arch}.tar.gz`;
const DOWNLOAD = "https://github.com/osrim/niksi/releases/download";

export type Channel = "stable" | "alpha";

interface Flavor {
  name: string;
  className: string;
  desc: string;
  conflict: string;
  caveats: string;
}

const FLAVORS: Record<Channel, Flavor> = {
  stable: {
    name: "niksi",
    className: "Niksi",
    desc: "Install, review, and share agent skills",
    conflict: "niksi-alpha",
    caveats: `      ski was renamed to niksi. The command is now nik.
      Run any nik command in an existing project to migrate ski-lock.json and .ski.
      See https://github.com/osrim/niksi/releases/tag/v0.3.0`,
  },
  alpha: {
    name: "niksi-alpha",
    className: "NiksiAlpha",
    desc: "Install, review, and share agent skills (alpha channel)",
    conflict: "niksi",
    caveats: `      niksi-alpha follows every niksi release, alphas included.
      To go back to stable releases:
        brew uninstall niksi-alpha && brew install osrim/tap/niksi`,
  },
};

export const formulaName = (channel: Channel): string => FLAVORS[channel].name;

export const sha256For = (checksums: string, name: string): string => {
  const line = checksums.split("\n").find((entry) => entry.trim().endsWith(` ${name}`));
  const sha = line?.trim().split(/\s+/u)[0];
  if (!sha || !/^[0-9a-f]{64}$/u.test(sha)) throw new Error(`no sha256 for ${name}`);
  return sha;
};

interface Release {
  version: string;
  checksums: string;
}

const source = (release: Release, os: string, arch: string): string => {
  const name = asset(os, arch);
  return `      url "${DOWNLOAD}/v${release.version}/${name}"
      sha256 "${sha256For(release.checksums, name)}"`;
};

// Homebrew rejects url/sha256 inside top-level on_arm/on_intel, hence the CPU conditional.
const onSystem = (
  release: Release,
  os: "darwin" | "linux",
): string => `  on_${os === "darwin" ? "macos" : "linux"} do
    if Hardware::CPU.arm?
${source(release, os, "arm64")}
    else
${source(release, os, "x64")}
    end
  end`;

export const renderFormula = (channel: Channel, version: string, checksums: string): string => {
  const flavor = FLAVORS[channel];
  const release = { version, checksums };
  return `class ${flavor.className} < Formula
  desc "${flavor.desc}"
  homepage "https://github.com/osrim/niksi"
  version "${version}"
  license "MIT"

  depends_on "git"

${onSystem(release, "darwin")}

${onSystem(release, "linux")}

  conflicts_with "osrim/tap/${flavor.conflict}", because: "both install the nik command"

  def install
    bin.install "nik"
    generate_completions_from_executable(bin/"nik", "completion")
  end

  def caveats
    <<~EOS
${flavor.caveats}
    EOS
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/nik --version")
  end
end
`;
};

export const formulaVersion = (formula: string): string | null =>
  formula.match(/^ {2}version "([^"]+)"$/mu)?.[1] ?? null;

// A stable patch tagged after an alpha, or a re-run of an old tag, must not move a formula back.
export const supersedes = (version: string, existing: string | null): boolean =>
  existing === null || Bun.semver.order(version, existing) >= 0;

export const writeFormula = async (
  channel: Channel,
  version: string,
  checksums: string,
  tapDir: string,
): Promise<string> => {
  const path = join(tapDir, "Formula", `${formulaName(channel)}.rb`);
  const file = Bun.file(path);
  const existing = (await file.exists()) ? formulaVersion(await file.text()) : null;
  if (!supersedes(version, existing)) return `${path}: kept ${existing}, newer than ${version}`;
  await mkdir(join(tapDir, "Formula"), { recursive: true });
  await Bun.write(path, renderFormula(channel, version, checksums));
  return `${path}: ${existing ?? "new"} -> ${version}`;
};

if (import.meta.main) {
  const [channel, version, checksumsPath, tapDir] = Bun.argv.slice(2);
  if ((channel !== "stable" && channel !== "alpha") || !version || !checksumsPath || !tapDir) {
    console.error(
      "usage: bun scripts/brew-formula.ts <stable|alpha> <version> <checksums.txt> <tap-dir>",
    );
    process.exit(2);
  }
  const checksums = await Bun.file(checksumsPath).text();
  console.info(await writeFormula(channel, version, checksums, tapDir));
}
