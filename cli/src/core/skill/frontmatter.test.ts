import { expect, test } from "bun:test";
import { frontmatterBlock, parseFrontmatter } from "./frontmatter.ts";

test("parseFrontmatter reads, normalises, and trims a frontmatter mapping", () => {
  const fm = parseFrontmatter("---\nNAME: x\ndescription: ' y z '\nallowed-tools: Read\n---\nbody");
  expect(fm).toEqual({ name: "x", description: "y z", "allowed-tools": "Read" });
  expect(parseFrontmatter("no frontmatter")).toEqual({});
});

test("parseFrontmatter throws when the block is not a mapping", () => {
  expect(() => parseFrontmatter("---\njust a scalar\n---\n")).toThrow(SyntaxError);
  expect(parseFrontmatter("---\n\n---\n")).toEqual({});
});

test("parseFrontmatter reads frontmatter after a byte order mark, and empty frontmatter", () => {
  expect(parseFrontmatter("\uFEFF---\nname: x\n---\nbody")).toEqual({ name: "x" });
  expect(parseFrontmatter("---\n---\nbody")).toEqual({});
  expect(parseFrontmatter("---\r\nname: x\r\n---\r\nbody")).toEqual({ name: "x" });
});

test("the first --- after the opening line closes the frontmatter, as Claude Code reads it", () => {
  expect(frontmatterBlock("---\na: 1\n---\nbody")).toEqual({ yaml: "a: 1\n", end: 12 });
  expect(frontmatterBlock("---\n---")).toEqual({ yaml: "", end: 7 });
  expect(frontmatterBlock("---\na: 1\n--- # end\nbody")).toEqual({ yaml: "a: 1\n", end: 12 });
  expect(frontmatterBlock("---\na: 1\n---x\nb: 2\n---\n")).toEqual({ yaml: "a: 1\n", end: 12 });
  expect(frontmatterBlock("---\na: b---c\n---\n")).toEqual({ yaml: "a: b", end: 11 });
  expect(frontmatterBlock("--- x\na: 1\n---\n")).toBeUndefined();
  expect(frontmatterBlock("body\n---\na: 1\n---\n")).toBeUndefined();
  expect(frontmatterBlock("---\na: 1\n")).toBeUndefined();
});

test("a closing --- followed by text still applies the fields before it", () => {
  for (const close of ["---x", "--- # end"]) {
    expect(parseFrontmatter(`---\nallowed-tools: Bash\n${close}\nbody`)).toEqual({
      "allowed-tools": "Bash",
    });
  }
});
