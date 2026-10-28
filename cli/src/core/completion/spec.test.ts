import { expect, test } from "bun:test";
import { cac } from "cac";
import { completionSpec, parseShell } from "./spec.ts";

const fixtureCli = () => {
  const cli = cac("nik");
  cli
    .command("add <coordinate> [...skills]", "Add skills")
    .option("-g, --global", "Use global scope")
    .option("--agent <id>", "Agents to install to: universal, claude")
    .option("--path <directory>", "Write below a root")
    .option("--report <file>", "Write a report");
  cli
    .command("remove [...skills]", "Remove skills")
    .alias("rm")
    .option("-g, --global", "Use global scope");
  cli.command("completion <shell>", "Print a completion script");
  cli.command("prune", "Delete store entries");
  cli.help();
  cli.version("1.0.0");
  return cli;
};

const spec = completionSpec(fixtureCli());
const command = (name: string) => spec.commands.find((entry) => entry.name === name)!;

test("flags keep their short and long names and what their value is", () => {
  expect(command("add").flags).toEqual([
    { short: "g", long: "global", value: "none", description: "Use global scope" },
    { long: "agent", value: "agent", description: "Agents to install to: universal, claude" },
    { long: "path", value: "directory", description: "Write below a root" },
    { long: "report", value: "file", description: "Write a report" },
    { short: "h", long: "help", value: "none", description: "Display this message" },
  ]);
});

test("the first positional decides what the command completes", () => {
  expect(command("add").positional).toBe("files");
  expect(command("remove").positional).toBe("skills");
  expect(command("completion").positional).toBe("shells");
  expect(command("prune").positional).toBe("none");
});

test("commands keep their aliases, and the root offers help and version", () => {
  expect(command("remove").aliases).toEqual(["rm"]);
  expect(spec.rootFlags.map((flag) => flag.long)).toEqual(["help", "version"]);
  expect(spec.agents).toContain("qwen");
  expect(spec.agents).toContain("cursor");
});

test("parseShell accepts bash, zsh, and fish only", () => {
  expect(parseShell("zsh")).toBe("zsh");
  expect(() => parseShell("pwsh")).toThrow("Unknown shell: pwsh");
});
