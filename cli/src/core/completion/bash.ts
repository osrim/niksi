import {
  SHELLS,
  type CompletionCommand,
  type CompletionFlag,
  type CompletionSpec,
} from "./spec.ts";
import { SKILLS_HELPER } from "./skills.ts";

const flagNames = (flag: CompletionFlag): string[] => [
  ...(flag.short ? [`-${flag.short}`] : []),
  `--${flag.long}`,
];

const flagWords = (flags: CompletionFlag[]): string => flags.flatMap(flagNames).join(" ");

const valueArms = (command: CompletionCommand, agents: string[]): string[] =>
  command.flags.flatMap((flag) => {
    const names = flagNames(flag).join("|");
    if (flag.value === "agent")
      return [
        `        ${names}) COMPREPLY=($(compgen -W "${agents.join(" ")}" -- "$cur")); return ;;`,
      ];
    if (flag.value === "directory") return [`        ${names}) _nik_files -d; return ;;`];
    if (flag.value === "file") return [`        ${names}) _nik_files -f; return ;;`];
    return [];
  });

const positionalLines = (command: CompletionCommand): string[] => {
  switch (command.positional) {
    case "skills":
      return [
        `      [[ $cur == -* ]] || { _nik_skills ${command.name} "\${COMP_WORDS[@]:1:at-1}" "\${COMP_WORDS[@]:at+1:COMP_CWORD-at-1}"; return; }`,
      ];
    case "shells":
      return [`      words="${SHELLS.join(" ")}"`];
    case "files":
      return [`      [[ $cur == -* ]] || { _nik_files -f; return; }`];
    case "none":
      return [];
  }
};

const commandArm = (command: CompletionCommand, agents: string[]): string => {
  const values = valueArms(command, agents);
  return [
    `    ${[command.name, ...command.aliases].join("|")})`,
    ...(values.length > 0 ? ["      case $prev in", ...values, "      esac"] : []),
    `      flags="${flagWords(command.flags)}"`,
    ...positionalLines(command),
    "      ;;",
  ].join("\n");
};

export const bashScript = (
  spec: CompletionSpec,
): string => `# bash completion for nik. Load it with: source <(nik completion bash)

_nik_files() {
  compopt -o filenames 2>/dev/null
  local IFS=$'\\n'
  COMPREPLY=($(compgen "$1" -- "$cur"))
}

# Skill names may hold spaces, so each name stays one quoted candidate.
_nik_skills() {
  local name quoted
  COMPREPLY=()
  while IFS= read -r name; do
    printf -v quoted '%q' "$name"
    [[ $quoted == "$cur"* ]] && COMPREPLY+=("$quoted")
  done < <(command nik ${SKILLS_HELPER} "$@" 2>/dev/null)
}

_nik() {
  local cur=\${COMP_WORDS[COMP_CWORD]} prev=\${COMP_WORDS[COMP_CWORD-1]}
  local i at=0 command="" flags="" words=""
  for ((i = 1; i < COMP_CWORD; i++)); do
    if [[ \${COMP_WORDS[i]} != -* ]]; then
      command=\${COMP_WORDS[i]}
      at=$i
      break
    fi
  done
  case $command in
    "")
      flags="${flagWords(spec.rootFlags)}"
      words="${spec.commands.map((command) => command.name).join(" ")}"
      ;;
${spec.commands.map((command) => commandArm(command, spec.agents)).join("\n")}
  esac
  if [[ $cur == -* ]]; then
    COMPREPLY=($(compgen -W "$flags" -- "$cur"))
  else
    COMPREPLY=($(compgen -W "$words" -- "$cur"))
  fi
}

complete -F _nik nik
`;
