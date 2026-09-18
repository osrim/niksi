#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { constants } from "node:os";

const platform = `${process.platform}-${process.arch}`;
let binary;
try {
  binary = createRequire(import.meta.url).resolve(`@osrim/niksi-${platform}/nik`);
} catch {
  console.error(
    `niksi has no npm binary for ${platform}. See https://github.com/osrim/niksi#install`,
  );
  process.exit(1);
}

const result = spawnSync(binary, process.argv.slice(2), { stdio: "inherit" });
if (result.error) throw result.error;
process.exit(result.status ?? 128 + constants.signals[result.signal]);
