import {
  SHELLS,
  type CompletionCommand,
  type CompletionFlag,
  type CompletionSpec,
} from "./spec.ts";
import { SKILLS_HELPER } from "./skills.ts";

const quote = (text: string): string => `'${text.replaceAll(/[\\']/gu, (char) => `\\${char}`)}'`;

const VALUES: Record<CompletionFlag["value"], (agents: string[]) => string> = {
  none: () => "",
  agent: (agents) => ` -x -a ${quote(agents.join(" "))}`,
  directory: () => " -r -F",
  file: () => " -r -F",
};

const flagLine = (condition: string, flag: CompletionFlag, agents: string[]): string => {
  const short = flag.short ? ` -s ${flag.short}` : "";
  return `complete -c nik -n ${quote(condition)}${short} -l ${flag.long}${VALUES[flag.value](agents)} -d ${quote(flag.description)}`;
};

const POSITIONALS: Record<CompletionCommand["positional"], (name: string) => string> = {
  skills: (name) => `-a '(__nik_skills ${name})'`,
  shells: () => `-a ${quote(SHELLS.join(" "))}`,
  files: () => "-F",
  none: () => "",
};

const commandLines = (command: CompletionCommand, agents: string[]): string[] => {
  const condition = `__nik_using ${[command.name, ...command.aliases].join(" ")}`;
  const positional = POSITIONALS[command.positional](command.name);
  return [
    ...command.flags.map((flag) => flagLine(condition, flag, agents)),
    ...(positional ? [`complete -c nik -n ${quote(condition)} ${positional}`] : []),
  ];
};

export const fishScript = (
  spec: CompletionSpec,
): string => `# fish completion for nik. Save it as nik.fish in ~/.config/fish/completions, or load it with: nik completion fish | source

function __nik_tokens
    commandline -xpc 2>/dev/null; or commandline -opc
end

function __nik_command
    for token in (__nik_tokens)[2..-1]
        if not string match -q -- '-*' $token
            echo $token
            return
        end
    end
end

function __nik_needs_command
    set -l command (__nik_command)
    test -z "$command"
end

function __nik_using
    set -l command (__nik_command)
    contains -- "$command" $argv
end

function __nik_skills
    set -l words
    set -l found
    for token in (__nik_tokens)[2..-1]
        if test -z "$found"; and not string match -q -- '-*' $token
            set found 1
        else
            set -a words $token
        end
    end
    command nik ${SKILLS_HELPER} $argv[1] $words 2>/dev/null
end

complete -c nik -f
${spec.rootFlags.map((flag) => flagLine("__nik_needs_command", flag, spec.agents)).join("\n")}
${spec.commands.map((command) => `complete -c nik -n __nik_needs_command -a ${command.name} -d ${quote(command.description)}`).join("\n")}
${spec.commands.flatMap((command) => commandLines(command, spec.agents)).join("\n")}
`;
