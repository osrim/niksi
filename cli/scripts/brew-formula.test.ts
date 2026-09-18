import { expect, test } from "bun:test";
import { renderFormula, sha256For } from "./brew-formula.ts";

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
  const formula = renderFormula("0.1.0", CHECKSUMS);
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
  expect(formula).toContain("ski was renamed to niksi. The command is now nik.");
  expect(() => renderFormula("0.1.0", `${ARM}  niksi-darwin-arm64.tar.gz\n`)).toThrow("x64");
});
