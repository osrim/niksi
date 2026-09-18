import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PLATFORMS, mainPackage, platformPackage, writePackages } from "./npm-packages.ts";

test("the main package pins one optional dependency per shipped platform", () => {
  const pkg = mainPackage("0.4.0");
  expect(pkg.name).toBe("niksi");
  expect(pkg.version).toBe("0.4.0");
  expect(pkg.bin).toEqual({ nik: "bin/nik.js" });
  expect(pkg.type).toBe("module");
  expect(pkg.files).toEqual(["bin", "README.md"]);
  expect(pkg.optionalDependencies).toEqual({
    "@osrim/niksi-darwin-arm64": "0.4.0",
    "@osrim/niksi-darwin-x64": "0.4.0",
    "@osrim/niksi-linux-x64": "0.4.0",
    "@osrim/niksi-linux-arm64": "0.4.0",
  });
  expect(pkg.repository).toEqual({
    type: "git",
    url: "git+https://github.com/osrim/niksi.git",
    directory: "cli",
  });
  expect(pkg.publishConfig).toEqual({ access: "public" });
});

test("a platform package is restricted to its os and cpu and ships only the binary", () => {
  const pkg = platformPackage("0.4.0", "linux", "arm64");
  expect(pkg.name).toBe("@osrim/niksi-linux-arm64");
  expect(pkg.os).toEqual(["linux"]);
  expect(pkg.cpu).toEqual(["arm64"]);
  expect(pkg.files).toEqual(["nik"]);
  expect("bin" in pkg).toBe(false);
});

test("writePackages lays out one directory per package with the shim in the main one", async () => {
  const out = await mkdtemp(join(tmpdir(), "niksi-npm-"));
  await writePackages("0.4.0", out);
  const main = JSON.parse(await readFile(join(out, "niksi", "package.json"), "utf8"));
  expect(main.name).toBe("niksi");
  const shim = await readFile(join(out, "niksi", "bin", "nik.js"), "utf8");
  expect(shim.startsWith("#!/usr/bin/env node\n")).toBe(true);
  expect((await stat(join(out, "niksi", "bin", "nik.js"))).mode & 0o111).not.toBe(0);
  const readme = await readFile(join(out, "niksi", "README.md"), "utf8");
  expect(readme).toContain("npm install -g niksi");
  expect(readme).toContain("](https://github.com/osrim/niksi/blob/v0.4.0/docs/commands.md)");
  expect(readme).not.toMatch(/\]\((docs|CONTRIBUTING|LICENSE)/u);
  for (const [os, arch] of PLATFORMS) {
    const pkg = JSON.parse(
      await readFile(join(out, `niksi-${os}-${arch}`, "package.json"), "utf8"),
    );
    expect(pkg.name).toBe(`@osrim/niksi-${os}-${arch}`);
    expect(pkg.version).toBe("0.4.0");
    expect(await readFile(join(out, `niksi-${os}-${arch}`, "LICENSE"), "utf8")).toContain("MIT");
  }
  expect(await readFile(join(out, "niksi", "LICENSE"), "utf8")).toContain("MIT");
});

const installed = async (binary: string): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "niksi-npm-"));
  const staged = join(root, "staged");
  await writePackages("0.0.0", staged);
  const modules = join(root, "node_modules");
  await cp(join(staged, "niksi"), join(modules, "niksi"), { recursive: true });
  const nik = join(modules, "@osrim", `niksi-${process.platform}-${process.arch}`, "nik");
  await mkdir(dirname(nik), { recursive: true });
  await writeFile(nik, binary, { mode: 0o755 });
  return join(modules, "niksi", "bin", "nik.js");
};

test("the shim runs the platform binary with the arguments and exit code", async () => {
  const shim = await installed('#!/bin/sh\nprintf "%s\\n" "$@"\nexit 7\n');
  const run = Bun.spawnSync(["node", shim, "add", "--yes"]);
  expect(run.stdout.toString()).toBe("add\n--yes\n");
  expect(run.exitCode).toBe(7);
});

test("the shim reports a signal-killed binary as 128 plus the signal", async () => {
  const shim = await installed("#!/bin/sh\nkill -INT $$\n");
  expect(Bun.spawnSync(["node", shim]).exitCode).toBe(130);
});

test("the shim fails clearly without a package for this platform", async () => {
  const shim = await installed("");
  await rm(join(dirname(shim), "..", "..", "@osrim"), { recursive: true });
  const run = Bun.spawnSync(["node", shim, "--version"]);
  expect(run.exitCode).toBe(1);
  expect(run.stderr.toString()).toContain(
    `niksi has no npm binary for ${process.platform}-${process.arch}`,
  );
});
