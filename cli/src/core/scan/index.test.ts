import { expect, test } from "bun:test";
import { MODE_EXEC, MODE_FILE } from "../skill/files.ts";
import { CRITICAL_EXIT, runScanners } from "./index.ts";

test("critical findings exit 3", () => {
  expect(CRITICAL_EXIT).toBe(3);
});

test("findings come back critical first, then warn, then info", () => {
  const findings = runScanners({
    name: "demo",
    files: [
      {
        path: "SKILL.md",
        content: Buffer.from("---\nname: demo\ndescription: test\n---\nSee https://other.dev/x.\n"),
        mode: MODE_FILE,
      },
      { path: "run.sh", content: Buffer.from("echo hi\n"), mode: MODE_EXEC },
      { path: "hooks.json", content: Buffer.from("{}\n"), mode: MODE_FILE },
    ],
  });

  expect(findings.map(({ severity, rule }) => `${severity} ${rule}`)).toEqual([
    "critical agent-config",
    "warn executable",
    "info external-url",
  ]);
});
