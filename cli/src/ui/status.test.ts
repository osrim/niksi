import { describe, expect, test } from "bun:test";
import { sourceFor } from "../core/source/index.ts";
import type { UpdatableVerdict } from "../core/source/upstream.ts";
import { describeUpdate } from "./status.ts";

const verdict = (kind: UpdatableVerdict["kind"]): UpdatableVerdict => ({
  kind,
  skill: {
    name: "tdd",
    source: "r",
    branch: "main",
    path: "skills/tdd",
    commit: "a".repeat(40),
    integrity: "sha256-qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo=",
    track: "auto",
  },
  source: sourceFor("r"),
  upstream: { commit: "b".repeat(40), branch: "main", track: "auto" },
  ahead: 2,
});

describe("describeUpdate", () => {
  test("a moved skill is hinted no file changes", () => {
    expect(describeUpdate(verdict("moved"))).toBe("no file changes");
  });

  test("an outdated skill keeps its commits and revision range", () => {
    expect(describeUpdate(verdict("outdated"))).toBe("2 new commit(s) (aaaaaaaa → bbbbbbbb)");
  });
});
