import { afterAll, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formulaVersion,
  renderFormula,
  sha256For,
  supersedes,
  writeFormula,
} from "./brew-formula.ts";

const tmp = await mkdtemp(join(tmpdir(), "niksi-brew-formula-"));
afterAll(() => rm(tmp, { recursive: true, force: true }));

const ARM = "a".repeat(64);
const X64 = "b".repeat(64);
const LINUX_ARM = "c".repeat(64);
const LINUX_X64 = "d".repeat(64);
const CHECKSUMS =
  `${ARM}  niksi-darwin-arm64.tar.gz\n${X64}  niksi-darwin-x64.tar.gz\n` +
  `${LINUX_ARM}  niksi-linux-arm64.tar.gz\n${LINUX_X64}  niksi-linux-x64.tar.gz\n`;

test("sha256For picks the line for the asset", () => {
  expect(sha256For(CHECKSUMS, "niksi-darwin-arm64.tar.gz")).toBe(ARM);
  expect(() => sha256For(CHECKSUMS, "missing.tar.gz")).toThrow("no sha256");
  expect(() =>
    sha256For("nope  niksi-darwin-arm64.tar.gz\n", "niksi-darwin-arm64.tar.gz"),
  ).toThrow();
});

test("renderFormula points each platform at its tagged asset", () => {
  const formula = renderFormula("stable", "0.1.0", CHECKSUMS);
  for (const name of ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"]) {
    expect(formula).toContain(
      `url "https://github.com/osrim/niksi/releases/download/v0.1.0/niksi-${name}.tar.gz"`,
    );
  }
  for (const sha of [ARM, X64, LINUX_ARM, LINUX_X64]) expect(formula).toContain(`sha256 "${sha}"`);
  expect(formula).toContain('version "0.1.0"');
  expect(formula).toContain("on_macos do");
  expect(formula).toContain("on_linux do");
  expect(formula).not.toContain("depends_on :macos");
  expect(formula).toContain('bin.install "nik"');
  expect(formula).toContain('generate_completions_from_executable(bin/"nik", "completion")');
  expect(formula).toContain("class Niksi < Formula");
  expect(formula).toContain('conflicts_with "osrim/tap/niksi-alpha"');
  expect(formula).toContain("ski was renamed to niksi. The command is now nik.");
  expect(() => renderFormula("stable", "0.1.0", `${ARM}  niksi-darwin-arm64.tar.gz\n`)).toThrow(
    "x64",
  );
});

test("the alpha formula is its own formula that conflicts with the stable one", () => {
  const formula = renderFormula("alpha", "0.5.0-alpha.1", CHECKSUMS);
  expect(formula).toContain("class NiksiAlpha < Formula");
  expect(formula).toContain('desc "Install, review, and share agent skills (alpha channel)"');
  expect(formula).toContain(
    'url "https://github.com/osrim/niksi/releases/download/v0.5.0-alpha.1/niksi-linux-x64.tar.gz"',
  );
  expect(formula).toContain('conflicts_with "osrim/tap/niksi", because:');
  expect(formula).toContain("brew uninstall niksi-alpha && brew install osrim/tap/niksi");
  expect(formula).not.toContain("ski was renamed");
});

test("formulaVersion reads the version a rendered formula holds", () => {
  expect(formulaVersion(renderFormula("alpha", "0.5.0-alpha.1", CHECKSUMS))).toBe("0.5.0-alpha.1");
  expect(formulaVersion("class Niksi < Formula\nend\n")).toBeNull();
});

test("supersedes never moves a formula to an older version", () => {
  expect(supersedes("0.5.0-alpha.0", null)).toBe(true);
  expect(supersedes("0.5.0-alpha.1", "0.5.0-alpha.0")).toBe(true);
  expect(supersedes("0.5.0-alpha.10", "0.5.0-alpha.9")).toBe(true);
  expect(supersedes("0.5.0", "0.5.0-alpha.3")).toBe(true);
  expect(supersedes("0.4.2", "0.4.2")).toBe(true);
  expect(supersedes("0.4.3", "0.5.0-alpha.1")).toBe(false);
  expect(supersedes("0.5.0-alpha.3", "0.5.0")).toBe(false);
});

test("writeFormula writes a newer version and keeps a newer existing formula", async () => {
  const path = join(tmp, "Formula", "niksi-alpha.rb");
  await writeFormula("alpha", "0.5.0-alpha.1", CHECKSUMS, tmp);
  const alpha = await readFile(path, "utf8");
  expect(formulaVersion(alpha)).toBe("0.5.0-alpha.1");

  expect(await writeFormula("alpha", "0.4.3", CHECKSUMS, tmp)).toContain("kept 0.5.0-alpha.1");
  expect(await readFile(path, "utf8")).toBe(alpha);

  await writeFormula("alpha", "0.5.0", CHECKSUMS, tmp);
  expect(formulaVersion(await readFile(path, "utf8"))).toBe("0.5.0");
});
