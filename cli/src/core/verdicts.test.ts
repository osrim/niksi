import { expect, test } from "bun:test";
import { checkExitCode, checkedSkill } from "./verdicts.ts";
import { sourceFor } from "./source/index.ts";
import type { UpdateVerdict } from "./source/upstream.ts";

const OLD = "a".repeat(40);
const NEW = "b".repeat(40);
const SOURCE = "https://github.com/o/r";

const verdict = (kind: UpdateVerdict["kind"], extra: object = {}): UpdateVerdict =>
  ({
    kind,
    skill: {
      name: "pdf",
      source: SOURCE,
      path: "skills/pdf",
      commit: OLD,
      branch: "main",
      tag: "v1.0.0",
      integrity: "sha256-x",
      track: "auto",
      agents: ["claude"],
    },
    source: sourceFor(SOURCE),
    upstream: { commit: NEW, branch: "main", tag: "v1.1.0", track: "auto" },
    ahead: 2,
    age: 86_400,
    ...extra,
  }) as UpdateVerdict;

test("an outdated skill reports its recorded and upstream commit and tag, and nothing else", () => {
  expect(checkedSkill(verdict("outdated", { waiting: true }))).toEqual({
    name: "pdf",
    source: SOURCE,
    path: "skills/pdf",
    track: "auto",
    verdict: "outdated",
    recorded: { commit: OLD, tag: "v1.0.0" },
    upstream: { commit: NEW, tag: "v1.1.0" },
  });
});

test("an unreachable skill carries the error and an empty upstream", () => {
  const entry = checkedSkill(
    verdict("unreachable", { upstream: { track: "auto" }, ahead: 0, error: "no route" }),
  );

  expect(entry).toMatchObject({
    verdict: "unreachable",
    upstream: {},
    error: "no route",
  });
});

test("the exit code is 0 only when every checked skill is up to date", () => {
  expect(checkExitCode([], 0)).toBe(0);
  expect(checkExitCode([verdict("up-to-date")], 0)).toBe(0);
});

test.each(["outdated", "moved", "pinned", "rewritten", "gone", "unreachable"] as const)(
  "a %s skill exits 1",
  (kind) => {
    expect(checkExitCode([verdict("up-to-date"), verdict(kind)], 0)).toBe(1);
  },
);

test("a skill the project policy leaves out exits 3, over any other result", () => {
  expect(checkExitCode([verdict("up-to-date")], 1)).toBe(3);
  expect(checkExitCode([verdict("outdated")], 1)).toBe(3);
});
