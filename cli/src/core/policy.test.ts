import { describe, expect, test } from "bun:test";
import { lockViolations, sourceViolation } from "./policy.ts";
import type { ProjectPolicy } from "./project-config.ts";
import { recordedLock } from "../test-cli.ts";

const POLICY: ProjectPolicy = {
  sources: { github: ["osrim", "Anthropics"], git: ["https://git.example.com/team/skills"] },
};

describe("sourceViolation", () => {
  test.each([
    "https://github.com/osrim/skills",
    "https://github.com/OSRIM/skills",
    "https://github.com/anthropics/skills",
    "ssh://git@github.com/osrim/skills.git",
    "git@github.com:osrim/skills.git",
    "https://git.example.com/team/skills",
    "local:.",
    "local:/",
  ])("%s is allowed", (source) => {
    expect(sourceViolation(POLICY, source)).toBeUndefined();
  });

  test.each([
    "https://github.com/evil/skills",
    "https://github.com/osrim-evil/skills",
    "https://github.com.evil.example/osrim/skills",
    "https://gitlab.com/osrim/skills",
    "git@gitlab.com:osrim/skills.git",
    "https://git.example.com/team/skills.git",
    "https://git.example.com/team/other",
    "file:///srv/git/skills",
  ])("%s breaks the policy", (source) => {
    expect(sourceViolation(POLICY, source)).toBe(`source ${source} is not allowed by niksi.json`);
  });

  test("without sources, every source is allowed", () => {
    expect(sourceViolation({}, "https://github.com/evil/skills")).toBeUndefined();
    expect(sourceViolation(undefined, "https://github.com/evil/skills")).toBeUndefined();
  });

  test("empty sources allow only local sources", () => {
    expect(sourceViolation({ sources: {} }, "local:.")).toBeUndefined();
    expect(sourceViolation({ sources: {} }, "https://github.com/osrim/skills")).toBe(
      "source https://github.com/osrim/skills is not allowed by niksi.json",
    );
  });
});

describe("lockViolations", () => {
  test("names each entry that breaks the policy, in name order", () => {
    const lock = recordedLock("https://github.com/evil/skills", "tdd", "grilling");
    lock.skills.pdf = { ...lock.skills.tdd!, source: "https://github.com/osrim/skills" };

    expect(lockViolations(POLICY, lock)).toEqual([
      {
        name: "grilling",
        reason: "source https://github.com/evil/skills is not allowed by niksi.json",
      },
      { name: "tdd", reason: "source https://github.com/evil/skills is not allowed by niksi.json" },
    ]);
  });

  test("a lockfile within the policy has no violations", () => {
    expect(lockViolations(POLICY, recordedLock("local:.", "hello"))).toEqual([]);
  });
});
