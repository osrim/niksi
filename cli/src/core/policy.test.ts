import { describe, expect, test } from "bun:test";
import { policyViolations, sourceViolation } from "./policy.ts";
import type { ProjectPolicy } from "./project-config.ts";

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
    "ssh://git@github.com:22/osrim/skills.git",
    "https://GitHub.com/osrim/skills",
    "https://github.com/osrim/skills/",
    "https://git.example.com/team/skills",
    "local:.",
    "local:/",
  ])("%p is allowed", (source) => {
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
    "https://github.com\\osrim\\@evil.example/skills",
    "https://git\thub.com/osrim/skills",
    "https://github.com@evil.example/osrim/skills",
    "https://github.com/evil/%2e%2e/osrim/skills",
    "https://github.com/evil/../osrim/skills",
    "ssh://git@github.com/evil/../osrim/skills",
    "git@github.com:osrim/../../evil/skills",
    "git@github.com:/osrim/skills",
  ])("%p breaks the policy", (source) => {
    expect(sourceViolation(POLICY, source)).toBe(
      `source ${source} is not allowed by policy.sources in niksi.json`,
    );
  });

  test("without sources, every source is allowed", () => {
    expect(sourceViolation({}, "https://github.com/evil/skills")).toBeUndefined();
    expect(sourceViolation(undefined, "https://github.com/evil/skills")).toBeUndefined();
  });

  test("empty sources allow only local sources", () => {
    expect(sourceViolation({ sources: {} }, "local:.")).toBeUndefined();
    expect(sourceViolation({ sources: {} }, "https://github.com/osrim/skills")).toBe(
      "source https://github.com/osrim/skills is not allowed by policy.sources in niksi.json",
    );
  });
});

describe("policyViolations", () => {
  test("names each entry that breaks the policy, in name order", () => {
    const skills = [
      { name: "tdd", source: "https://github.com/evil/skills" },
      { name: "pdf", source: "https://github.com/osrim/skills" },
      { name: "grilling", source: "https://github.com/evil/skills" },
    ];

    expect(policyViolations(POLICY, skills)).toEqual([
      {
        name: "grilling",
        reason:
          "source https://github.com/evil/skills is not allowed by policy.sources in niksi.json",
      },
      {
        name: "tdd",
        reason:
          "source https://github.com/evil/skills is not allowed by policy.sources in niksi.json",
      },
    ]);
  });

  test("skills within the policy have no violations", () => {
    expect(policyViolations(POLICY, [{ name: "hello", source: "local:." }])).toEqual([]);
  });
});
