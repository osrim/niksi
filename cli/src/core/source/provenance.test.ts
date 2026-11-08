import { expect, test } from "bun:test";
import type { SkillFile } from "../skill/files.ts";
import { ghSkillHint, skillsLockHints } from "./provenance.ts";

const skillMd = (text: string): SkillFile[] => [
  { path: "SKILL.md", content: Buffer.from(text), mode: "100644" },
];

// The shape `gh skill install` writes, from cli/cli internal/skills/frontmatter.
const GH_INSTALLED = `---
description: Fill PDF forms.
metadata:
    github-path: skills/pdf
    github-ref: v1.2.0
    github-repo: https://github.com/anthropics/skills
    github-tree-sha: 4b825dc642cb6eb9a060e54bf8d69288fbee4904
name: pdf
---
# PDF
`;

test("ghSkillHint reads the repository, path, and tree that gh skill records", () => {
  expect(ghSkillHint(skillMd(GH_INSTALLED))).toEqual({
    source: "https://github.com/anthropics/skills",
    path: "skills/pdf",
    tree: "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
    via: "gh skill metadata",
  });
});

test("ghSkillHint pins to github-pinned", () => {
  const pinned = GH_INSTALLED.replace(
    "    github-ref:",
    "    github-pinned: v1.2.0\n    github-ref:",
  );
  expect(ghSkillHint(skillMd(pinned))?.pinned).toBe("v1.2.0");
});

test("ghSkillHint ignores a SKILL.md without gh metadata, or with an unusable one", () => {
  expect(ghSkillHint(skillMd("---\nname: pdf\n---\n"))).toBeUndefined();
  expect(ghSkillHint(skillMd("no frontmatter"))).toBeUndefined();
  expect(ghSkillHint(skillMd("---\n[broken\n---\n"))).toBeUndefined();
  expect(ghSkillHint([])).toBeUndefined();
  const local = "---\nname: pdf\nmetadata:\n  local-path: /work/pdf\n---\n";
  expect(ghSkillHint(skillMd(local))).toBeUndefined();
  const http = GH_INSTALLED.replace("https://github.com", "http://github.com");
  expect(ghSkillHint(skillMd(http))).toBeUndefined();
  const escape = GH_INSTALLED.replace("github-path: skills/pdf", "github-path: ../pdf");
  expect(ghSkillHint(skillMd(escape))).toBeUndefined();
});

test("ghSkillHint uses only an https repository, as gh skill writes", () => {
  for (const repo of [
    "ssh://git@example.com/anthropics/skills",
    "git@example.com:anthropics/skills",
    "file:///tmp/skills",
    "anthropics/skills",
  ]) {
    const other = GH_INSTALLED.replace("https://github.com/anthropics/skills", repo);
    expect(ghSkillHint(skillMd(other))).toBeUndefined();
  }
});

// The shape `npx skills` writes, from vercel-labs/skills src/local-lock.ts.
const PROJECT_LOCK = JSON.stringify({
  version: 1,
  skills: {
    pdf: {
      source: "anthropics/skills",
      sourceType: "github",
      skillPath: "skills/pdf/SKILL.md",
      computedHash: "ab12",
    },
    pinned: {
      source: "acme/tools",
      sourceUrl: "https://git.example.com/acme/tools.git",
      ref: "v2.0.0",
      sourceType: "git",
      skillPath: "SKILL.md",
      computedHash: "cd34",
    },
    mine: { source: "./my-skills/mine", sourceType: "local", computedHash: "ef56" },
    npm: { source: "some-package", sourceType: "node_modules", computedHash: "0000" },
  },
});

test("skillsLockHints maps each remote entry to its source, path, and pinned ref", () => {
  const hints = skillsLockHints(PROJECT_LOCK, "skills-lock.json");
  expect(hints.get("pdf")).toEqual({
    source: "https://github.com/anthropics/skills",
    path: "skills/pdf",
    via: "skills-lock.json",
  });
  expect(hints.get("pinned")).toEqual({
    source: "https://git.example.com/acme/tools.git",
    path: "",
    pinned: "v2.0.0",
    via: "skills-lock.json",
  });
  expect(hints.has("mine")).toBe(false);
  expect(hints.has("npm")).toBe(false);
});

// The global lockfile that npx skills and gh skill share, version 3.
test("skillsLockHints reads the global lockfile and its pinnedRef", () => {
  const global = JSON.stringify({
    version: 3,
    skills: {
      pdf: {
        source: "anthropics/skills",
        sourceType: "github",
        sourceUrl: "https://github.com/anthropics/skills.git",
        skillPath: "skills/pdf/SKILL.md",
        skillFolderHash: "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
        installedAt: "2026-04-18T10:00:00Z",
        updatedAt: "2026-04-18T10:00:00Z",
        pinnedRef: "v1.2.0",
      },
    },
  });
  expect(skillsLockHints(global, ".skill-lock.json").get("pdf")).toEqual({
    source: "https://github.com/anthropics/skills",
    path: "skills/pdf",
    pinned: "v1.2.0",
    tree: "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
    via: ".skill-lock.json",
  });
});

test("skillsLockHints returns no hints for a file it cannot read", () => {
  expect(skillsLockHints("", "skills-lock.json").size).toBe(0);
  expect(skillsLockHints("{not json", "skills-lock.json").size).toBe(0);
  expect(skillsLockHints('{"version":9,"skills":{}}', "skills-lock.json").size).toBe(0);
  expect(skillsLockHints('{"version":1}', "skills-lock.json").size).toBe(0);
});
