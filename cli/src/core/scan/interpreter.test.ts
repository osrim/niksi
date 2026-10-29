import { expect, test } from "bun:test";
import { commandName, runsStdin } from "./interpreter.ts";

test("a command name drops its path and surrounding punctuation", () => {
  expect(commandName("/usr/bin/python3")).toBe("python3");
  expect(commandName("(sh")).toBe("sh");
});

test("an interpreter reads stdin unless it runs a script or a code flag", () => {
  expect(runsStdin(["sh"], false)).toBe(true);
  expect(runsStdin(["bash", "-s", "--", "x"], false)).toBe(true);
  expect(runsStdin(["python3", "parse.py"], false)).toBe(false);
  expect(runsStdin(["python3", "-c", "print(1)"], false)).toBe(false);
  expect(runsStdin(["bun", "run", "x.ts"], false)).toBe(false);
  expect(runsStdin(["iex"], false)).toBe(true);
  expect(runsStdin(["cat"], false)).toBe(false);
});

test("prose words after an interpreter are not a script unless they look like a path", () => {
  expect(runsStdin(["sh", "to", "install"], true)).toBe(true);
  expect(runsStdin(["sh", "./install.sh"], true)).toBe(false);
});
