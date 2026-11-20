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

test("--- alone or before a space closes the frontmatter, --- before other text does not", () => {
  const text = "---\na: 1\n---x\nb: 2\n--- \nbody\n";
  expect(frontmatterBlock(text)).toEqual({
    yaml: "a: 1\n---x\nb: 2\n",
    end: text.indexOf("\nbody"),
  });
  expect(frontmatterBlock("---\na: 1\n---x\n")).toBeUndefined();
  expect(frontmatterBlock("---\n---")).toEqual({ yaml: "", end: 7 });
  expect(frontmatterBlock("---\na: 1\n--- # end\nbody")).toEqual({ yaml: "a: 1\n", end: 18 });
  expect(parseFrontmatter("---\nallowed-tools: Bash\n--- # end\nbody")).toEqual({
    "allowed-tools": "Bash",
  });
  expect(frontmatterBlock("--- x\na: 1\n---\n")).toBeUndefined();
  expect(frontmatterBlock("body\n---\na: 1\n---\n")).toBeUndefined();
});
