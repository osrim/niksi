import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { sourceFor } from "../core/source/index.ts";
import type { Revision } from "../core/source/revision.ts";
import type { UpdatableVerdict, UpdateVerdict } from "../core/source/upstream.ts";
import { captureOutput, type CapturedOutput } from "../test-output.ts";
import {
  describeUpdate,
  friendlySource,
  groupLabel,
  reportVerdicts,
  revisionRange,
} from "./status.ts";

const OLD = "a".repeat(40);
const NEW = "b".repeat(40);

const base = (name = "tdd", over: Partial<Revision> = {}, upstream: Partial<Revision> = {}) => ({
  skill: {
    name,
    source: "r",
    branch: "main",
    path: "skills/tdd",
    commit: OLD,
    integrity: "sha256-qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo=",
    track: "auto" as const,
    ...over,
  },
  source: sourceFor("r"),
  upstream: { commit: NEW, branch: "main", track: "auto" as const, ...upstream },
  ahead: 2,
});

const verdict = (kind: UpdatableVerdict["kind"]): UpdatableVerdict => ({ kind, ...base() });

describe("describeUpdate", () => {
  test("a moved skill is hinted no file changes", () => {
    expect(describeUpdate(verdict("moved"))).toBe("no file changes");
  });

  test("an outdated skill keeps its commits and revision range", () => {
    expect(describeUpdate(verdict("outdated"))).toBe("2 new commit(s) (aaaaaaaa → bbbbbbbb)");
  });

  test("an outdated skill without new commits says its content changed", () => {
    expect(describeUpdate({ ...verdict("outdated"), ahead: 0 })).toBe(
      "content changed (aaaaaaaa → bbbbbbbb)",
    );
  });
});

describe("revisionRange", () => {
  test("tags win over commits", () => {
    expect(revisionRange({ kind: "outdated", ...base("tdd", { tag: "v1" }, { tag: "v2" }) })).toBe(
      "v1 → v2",
    );
  });

  test("a local source has no range", () => {
    const { skill, source } = base();
    const { commit: _commit, branch: _branch, ...local } = skill;
    expect(
      revisionRange({
        kind: "outdated",
        skill: local,
        source,
        upstream: { track: "auto" },
        ahead: 0,
      }),
    ).toBe("");
  });
});

describe("friendlySource", () => {
  test.each([
    ["https://github.com/owner/repo", "owner/repo"],
    ["git@github.com:owner/repo.git", "owner/repo"],
    ["https://gitlab.com/group/repo.git", "gitlab.com/group/repo"],
    ["file:///tmp/repo", "/tmp/repo"],
  ])("%p reads as %p", (source, friendly) => {
    expect(friendlySource(source)).toBe(friendly);
  });
});

describe("groupLabel", () => {
  test("one shared tag move is named beside the source", () => {
    const items: UpdatableVerdict[] = [
      { kind: "outdated", ...base("a", { tag: "v1" }, { tag: "v2" }) },
      { kind: "outdated", ...base("b", { tag: "v1" }, { tag: "v2" }) },
    ];
    expect(Bun.stripANSI(groupLabel("https://github.com/o/r", items))).toBe("o/r (v1 → v2)");
  });

  test("different revisions leave only the source", () => {
    const items: UpdatableVerdict[] = [
      { kind: "outdated", ...base("a", { tag: "v1" }, { tag: "v2" }) },
      { kind: "outdated", ...base("b", { tag: "v0" }, { tag: "v2" }) },
    ];
    expect(Bun.stripANSI(groupLabel("https://github.com/o/r", items))).toBe("o/r");
  });
});

describe("reportVerdicts", () => {
  let output: CapturedOutput;

  beforeEach(() => {
    output = captureOutput();
    process.exitCode = 0;
  });

  afterEach(() => {
    output.restore();
    process.exitCode = 0;
  });

  test("moved and outdated verdicts are returned for the update and print nothing", () => {
    const moved: UpdateVerdict = { kind: "moved", ...base("m") };
    const outdated: UpdateVerdict = { kind: "outdated", ...base("o") };
    const upToDate: UpdateVerdict = { kind: "up-to-date", ...base("u") };

    expect(reportVerdicts([moved, outdated, upToDate], [], "project")).toEqual({
      moved: [moved],
      outdated: [outdated],
    });
    expect(output.text()).toBe("");
  });

  test.each<{ verdict: UpdateVerdict; message: string; named: number; unnamed: number }>([
    {
      verdict: { kind: "unreachable", error: "cannot reach r", ...base() },
      message: "tdd: no upstream. cannot reach r",
      named: 1,
      unnamed: 0,
    },
    {
      verdict: { kind: "gone", ...base() },
      message: "tdd: source no longer has skills/tdd. Skipped.",
      named: 0,
      unnamed: 0,
    },
    {
      verdict: { kind: "rewritten", pinnedAs: "v1", expected: OLD, actual: NEW, ...base() },
      message:
        'tdd: pinned ref "v1" was rewritten. aaaaaaaa → bbbbbbbb.\n│  Reinstall to accept it.',
      named: 1,
      unnamed: 0,
    },
    {
      verdict: { kind: "pinned", ...base("tdd", { pinnedAs: "v1" }, { tag: "v2" }) },
      message: "tdd: pinned at v1. Latest: v2.\n│  Run nik update tdd -g to update.",
      named: 0,
      unnamed: 0,
    },
  ])(
    "$verdict.kind prints its message and sets the exit code",
    ({ verdict: reported, message, named, unnamed }) => {
      expect(reportVerdicts([reported], [], "global")).toEqual({ moved: [], outdated: [] });
      expect(output.text()).toContain(message);
      expect(process.exitCode).toBe(unnamed);

      reportVerdicts([reported], ["tdd"], "global");
      expect(process.exitCode).toBe(named);
    },
  );
});
