import type { CAC, Command } from "cac";
import { AGENT_IDS, AGENTS } from "../install/agents.ts";
import { usageError } from "../usage.ts";

export const SHELLS = ["bash", "zsh", "fish"] as const;

export type Shell = (typeof SHELLS)[number];

export interface CompletionFlag {
  short?: string;
  long: string;
  value: "none" | "agent" | "directory" | "file";
  description: string;
}

export interface CompletionCommand {
  name: string;
  aliases: string[];
  description: string;
  flags: CompletionFlag[];
  positional: "skills" | "shells" | "files" | "none";
}

export interface CompletionSpec {
  commands: CompletionCommand[];
  rootFlags: CompletionFlag[];
  agents: string[];
}

export const parseShell = (value: string): Shell => {
  const shell = SHELLS.find((name) => name === value);
  if (!shell) throw usageError(`Unknown shell: ${value}\nShells: ${SHELLS.join(", ")}`);
  return shell;
};

const flagValue = (long: string, placeholder: string | undefined): CompletionFlag["value"] => {
  if (placeholder === undefined) return "none";
  if (long === "agent") return "agent";
  return placeholder === "directory" ? "directory" : "file";
};

const toFlag = (option: { rawName: string; description: string }): CompletionFlag => {
  const [names = "", placeholder] = option.rawName.split(/\s+[<[]/u);
  const tokens = names.split(",").map((token) => token.trim());
  const short = tokens.find((token) => /^-[^-]/u.test(token))?.slice(1);
  const long = tokens.find((token) => token.startsWith("--"))!.slice(2);
  return {
    ...(short === undefined ? {} : { short }),
    long,
    value: flagValue(long, placeholder?.replace(/[>\]]$/u, "")),
    description: option.description,
  };
};

const ARG_KINDS: Record<string, CompletionCommand["positional"]> = {
  skills: "skills",
  shell: "shells",
};

const toCommand = (command: Command, helpFlags: CompletionFlag[]): CompletionCommand => {
  const first = command.args[0]?.value;
  return {
    name: command.name,
    aliases: command.aliasNames,
    description: command.description,
    flags: [...command.options.map(toFlag), ...helpFlags],
    positional: first === undefined ? "none" : (ARG_KINDS[first] ?? "files"),
  };
};

export const completionSpec = (cli: CAC): CompletionSpec => {
  const rootFlags = cli.globalCommand.options.map(toFlag);
  const helpFlags = rootFlags.filter((flag) => flag.long === "help");
  return {
    commands: cli.commands.map((command) => toCommand(command, helpFlags)),
    rootFlags,
    agents: [...new Set([...AGENT_IDS, ...AGENTS.map((agent) => agent.name)])],
  };
};
