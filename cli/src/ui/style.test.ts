import { describe, expect, test } from "bun:test";
import { probe } from "../test-color.ts";

const ESC = "\u001B";

const CLACK = `
  const { enforceColorPolicy } = await import(DIR + "/style.ts");
  enforceColorPolicy();
  const p = await import("@clack/prompts");
  p.log.info("hello");
`;

const BUFFER = `
  const { enforceColorPolicy } = await import(DIR + "/style.ts");
  enforceColorPolicy();
  process.stdout.write(Buffer.from("\\u001B[31mred\\u001B[39m ✓\\n"));
`;

const TWICE = `
  const { enforceColorPolicy } = await import(DIR + "/style.ts");
  enforceColorPolicy();
  const first = process.stdout.write;
  enforceColorPolicy();
  process.stdout.write(first === process.stdout.write ? "same" : "stacked");
`;

describe("enforceColorPolicy", () => {
  test("strips clack's own colour when colour is off", async () => {
    const out = (await probe({ NO_COLOR: "1" }, CLACK)).join("\n");
    expect(out).toInclude("hello");
    expect(out).not.toInclude(ESC);
  });

  test("leaves clack alone when colour is on", async () => {
    expect((await probe({ FORCE_COLOR: "3" }, CLACK)).join("\n")).toInclude(ESC);
  });

  test("strips colour from a chunk written as bytes", async () => {
    const out = (await probe({ NO_COLOR: "1" }, BUFFER)).join("\n");
    expect(out).toBe("red ✓\n");
  });

  test("a second call does not stack another wrapper", async () => {
    expect((await probe({ NO_COLOR: "1" }, TWICE)).join("")).toBe("same");
  });
});
