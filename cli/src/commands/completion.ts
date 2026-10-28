import type { CAC } from "cac";
import { bashScript } from "../core/completion/bash.ts";
import { fishScript } from "../core/completion/fish.ts";
import {
  completionSpec,
  parseShell,
  type CompletionSpec,
  type Shell,
} from "../core/completion/spec.ts";
import { zshScript } from "../core/completion/zsh.ts";
import type { CommandHelp } from "../ui/help.ts";

export const help: CommandHelp = {
  description:
    "Print a completion script for bash, zsh, or fish. It completes commands, flags, agent ids, and the installed skill names that `update`, `remove`, `disable`, and `enable` take.",
  examples: [
    "$ source <(nik completion bash)",
    "$ source <(nik completion zsh)",
    "$ nik completion fish > ~/.config/fish/completions/nik.fish",
  ],
};

const SCRIPTS: Record<Shell, (spec: CompletionSpec) => string> = {
  bash: bashScript,
  zsh: zshScript,
  fish: fishScript,
};

export const run = (shell: string, cli: CAC): void => {
  process.stdout.write(SCRIPTS[parseShell(shell)](completionSpec(cli)));
};
