import {
  SHELLS,
  type CompletionCommand,
  type CompletionFlag,
  type CompletionSpec,
} from "./spec.ts";
import { SKILLS_HELPER } from "./skills.ts";

const quote = (text: string): string => `'${text.replaceAll("'", `'\\''`)}'`;

const bracketed = (text: string): string => text.replaceAll(/[\\[\]]/gu, (char) => `\\${char}`);

const VALUES: Record<CompletionFlag["value"], (agents: string[]) => string> = {
  none: () => "",
  agent: (agents) => `:agent:(${agents.join(" ")})`,
  directory: () => ":directory:_files -/",
  file: () => ":file:_files",
};

const flagSpec = (flag: CompletionFlag, exclusive: string, value = ""): string => {
  const rest = `[${bracketed(flag.description)}]${value}`;
  if (!flag.short) return quote(`${exclusive}--${flag.long}${rest}`);
  return `${quote(exclusive)}{-${flag.short},--${flag.long}}${quote(rest)}`;
};

const commandFlagSpec = (flag: CompletionFlag, agents: string[]): string =>
  flagSpec(flag, flag.short ? `(-${flag.short} --${flag.long})` : "", VALUES[flag.value](agents));

const POSITIONALS: Record<CompletionCommand["positional"], (name: string) => string[]> = {
  skills: (name) => [quote(`*: :_nik_skills ${name}`)],
  shells: () => [quote(`1:shell:(${SHELLS.join(" ")})`)],
  files: () => [quote("*: :_files")],
  none: () => [],
};

const commandArm = (command: CompletionCommand, agents: string[]): string => {
  const specs = [
    ...command.flags.map((flag) => commandFlagSpec(flag, agents)),
    ...POSITIONALS[command.positional](command.name),
  ];
  return [
    `        ${[command.name, ...command.aliases].join("|")})`,
    `          _arguments \\\n${specs.map((spec) => `            ${spec}`).join(" \\\n")}`,
    "          ;;",
  ].join("\n");
};

export const zshScript = (spec: CompletionSpec): string => `#compdef nik
# zsh completion for nik. Save it as _nik in a directory on $fpath, or load it with: source <(nik completion zsh)

# _arguments passes compadd options first and the nik command last.
# _nik_words keeps the words before the cursor, because _arguments drops those before the command.
_nik_skills() {
  local -a skills words_but_command
  local word found
  for word in $_nik_words; do
    if [[ -z $found && $word != -* ]]; then found=1; else words_but_command+=($word); fi
  done
  skills=(\${(f)"$(command nik ${SKILLS_HELPER} $argv[-1] $words_but_command 2>/dev/null)"})
  compadd "\${@[1,-2]}" -a skills
}

_nik() {
  local curcontext=$curcontext state line
  local -a _nik_words=(\${words[2,CURRENT-1]})
  local -a commands=(
${spec.commands.map((command) => `    ${quote(`${command.name}:${command.description}`)}`).join("\n")}
  )
  _arguments -C \\
${spec.rootFlags.map((flag) => `    ${flagSpec(flag, "(- *)")} \\`).join("\n")}
    '1: :->command' \\
    '*:: :->argument'
  case $state in
    command)
      _describe -t commands 'nik command' commands
      ;;
    argument)
      while [[ $words[1] == -* ]] && (( CURRENT > 1 )); do
        shift words
        (( CURRENT-- ))
      done
      if (( CURRENT == 1 )); then
        _describe -t commands 'nik command' commands
        return
      fi
      case $words[1] in
${spec.commands.map((command) => commandArm(command, spec.agents)).join("\n")}
      esac
      ;;
  esac
}

if [[ $zsh_eval_context[-1] == loadautofunc ]]; then
  _nik "$@"
else
  compdef _nik nik
fi
`;
