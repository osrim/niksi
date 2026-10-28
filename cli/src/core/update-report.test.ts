import { expect, test } from "bun:test";
import type { Finding } from "./scan/index.ts";
import { sourceFor } from "./source/index.ts";
import type { UpdateVerdict } from "./source/upstream.ts";
import { recordVerdicts, renderUpdateReport, type UpdateReport } from "./update-report.ts";

const OLD = "a".repeat(40);
const NEW = "b".repeat(40);

const empty = (over: Partial<UpdateReport> = {}): UpdateReport => ({
  scope: "project",
  updated: [],
  blocked: [],
  skipped: [],
  upToDate: [],
  ...over,
});

const warnLink: Finding = {
  severity: "warn",
  rule: "prompt-injection",
  help: "asks the agent to hide actions",
  file: "SKILL.md",
  line: 7,
  detail: "do not tell the user",
};

const criticalHook: Finding = {
  severity: "critical",
  rule: "hooks",
  help: "runs a configured command",
  file: "hooks.json",
  detail: "PreToolUse",
};

test("an updated skill shows its revision range, diff stat, and findings by severity", () => {
  const markdown = renderUpdateReport(
    empty({
      updated: [
        {
          name: "pdf",
          from: { tag: "v1.0.0", commit: OLD },
          to: { tag: "v1.1.0", commit: NEW },
          stat: " SKILL.md | 2 +-\n 1 file changed, 1 insertion(+), 1 deletion(-)\n",
          findings: [criticalHook, warnLink],
        },
      ],
    }),
  );

  expect(markdown).toBe(
    [
      "## nik update (project)",
      "",
      "### Updated",
      "",
      "#### `pdf`",
      "",
      "`v1.0.0` (`aaaaaaaa`) → `v1.1.0` (`bbbbbbbb`)",
      "",
      "```text",
      " SKILL.md | 2 +-",
      " 1 file changed, 1 insertion(+), 1 deletion(-)",
      "```",
      "",
      "Critical:",
      "",
      "- `hooks` (runs a configured command) in `hooks.json`: `PreToolUse`",
      "",
      "Warn:",
      "",
      "- `prompt-injection` (asks the agent to hide actions) in `SKILL.md:7`: `do not tell the user`",
      "",
    ].join("\n"),
  );
});

test("upstream text stays inside code spans and fences", () => {
  const markdown = renderUpdateReport(
    empty({
      updated: [
        {
          name: "pdf",
          from: { tag: "v1`<b>", commit: OLD },
          to: { commit: NEW },
          stat: " ```evil | 1 +\n",
          findings: [{ ...warnLink, detail: "a ``b`` c\n## Approved\u001b[31m\u202e" }],
        },
      ],
    }),
  );

  expect(markdown).toContain("`` v1`<b> `` (`aaaaaaaa`) → `bbbbbbbb`");
  expect(markdown).toContain(["````text", " ```evil | 1 +", "````"].join("\n"));
  expect(markdown).toContain(": ``` a ``b`` c ## Approved\\u001b[31m\\u202e ```");
});

test("blocked skills ask for a person, and skipped skills give their reason", () => {
  const markdown = renderUpdateReport(
    empty({
      scope: "global",
      blocked: [
        {
          name: "dangerous",
          from: { commit: OLD },
          to: { commit: NEW },
          stat: " hooks.json | 1 +\n",
          findings: [criticalHook],
        },
      ],
      skipped: [
        { kind: "declined", name: "declined" },
        { kind: "not-confirmed", name: "unconfirmed" },
        { kind: "not-selected", name: "later" },
        { kind: "failed", name: "broken", error: "disk full" },
        {
          kind: "pinned",
          name: "pinned",
          from: { tag: "v1.0.0", commit: OLD },
          to: { commit: NEW },
        },
        {
          kind: "rewritten",
          name: "moved-tag",
          pinnedAs: "v2",
          expected: { commit: OLD },
          actual: { commit: NEW },
        },
        { kind: "gone", name: "gone" },
        { kind: "unreachable", name: "offline", error: "could not resolve host" },
        { kind: "disabled", name: "off" },
      ],
      upToDate: ["fresh", "current"],
    }),
  );

  expect(markdown).toBe(
    [
      "## nik update (global)",
      "",
      "### Needs a person",
      "",
      "Critical findings block these skills until someone approves them in a terminal: `nik update dangerous -g`.",
      "",
      "#### `dangerous`",
      "",
      "`aaaaaaaa` → `bbbbbbbb`",
      "",
      "```text",
      " hooks.json | 1 +",
      "```",
      "",
      "Critical:",
      "",
      "- `hooks` (runs a configured command) in `hooks.json`: `PreToolUse`",
      "",
      "### Not updated",
      "",
      "- `declined`: declined at review",
      "- `unconfirmed`: write not confirmed",
      "- `later`: update available, not selected",
      "- `broken`: write failed: `disk full`",
      "- `pinned`: pinned at `v1.0.0` (`aaaaaaaa`), latest `bbbbbbbb`",
      "- `moved-tag`: pinned ref `v2` was rewritten from `aaaaaaaa` to `bbbbbbbb`",
      "- `gone`: no longer in the source",
      "- `offline`: no upstream: `could not resolve host`",
      "- `off`: disabled, not checked",
      "",
      "### Up to date",
      "",
      "`current`, `fresh`",
      "",
    ].join("\n"),
  );
});

test("a run that changed nothing says so", () => {
  expect(renderUpdateReport(empty())).toBe(
    ["## nik update (project)", "", "No skill changed.", ""].join("\n"),
  );
});

test("a moved revision shows no diff stat", () => {
  const markdown = renderUpdateReport(
    empty({
      updated: [{ name: "moved", from: { commit: OLD }, to: { commit: NEW }, findings: [] }],
    }),
  );

  expect(markdown).toContain(
    ["#### `moved`", "", "`aaaaaaaa` → `bbbbbbbb`", "", "No file changes.", ""].join("\n"),
  );
});

test("verdicts that stop before selection land in the report with their reason", () => {
  const verdict = (name: string, kind: string, extra: object = {}): UpdateVerdict =>
    ({
      kind,
      skill: {
        name,
        source: "r",
        path: name,
        commit: OLD,
        integrity: "sha256-x",
        track: "pin",
        pinnedAs: "v1",
      },
      source: sourceFor("r"),
      upstream: { commit: NEW, track: "pin" },
      ahead: 0,
      ...extra,
    }) as UpdateVerdict;
  const report = empty();

  recordVerdicts(report, [
    verdict("fresh", "up-to-date"),
    verdict("offline", "unreachable", { error: "no route" }),
    verdict("gone", "gone"),
    verdict("tag", "rewritten", { pinnedAs: "v1", expected: OLD, actual: NEW }),
    verdict("held", "pinned"),
    verdict("moved", "moved"),
    verdict("outdated", "outdated"),
  ]);

  expect(report.upToDate).toEqual(["fresh"]);
  expect(report.skipped).toEqual([
    { kind: "unreachable", name: "offline", error: "no route" },
    { kind: "gone", name: "gone" },
    {
      kind: "rewritten",
      name: "tag",
      pinnedAs: "v1",
      expected: { commit: OLD },
      actual: { commit: NEW },
    },
    {
      kind: "pinned",
      name: "held",
      from: expect.objectContaining({ pinnedAs: "v1", commit: OLD }),
      to: expect.objectContaining({ commit: NEW }),
    },
  ]);
});
