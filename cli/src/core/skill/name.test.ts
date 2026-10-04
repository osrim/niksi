import { expect, test } from "bun:test";
import { isValidSkillName, slugifySkillName } from "./name.ts";

test.each([
  ["pdf", "pdf"],
  ["My Skill", "my-skill"],
  ["Café  Notes!", "cafe-notes"],
  ["--edge--case--", "edge-case"],
  ["skills/pdf_tools", "skills-pdf-tools"],
  ["日本", ""],
])("slugifySkillName(%p) is %p", (input, slug) => {
  expect(slugifySkillName(input)).toBe(slug);
});

test.each([
  ["pdf", true],
  ["pdf-tools-2", true],
  ["a".repeat(64), true],
  ["a".repeat(65), false],
  ["PDF", false],
  ["pdf_tools", false],
  ["-pdf", false],
  ["pdf--tools", false],
  ["", false],
])("isValidSkillName(%p) is %p", (name, valid) => {
  expect(isValidSkillName(name)).toBe(valid);
});
