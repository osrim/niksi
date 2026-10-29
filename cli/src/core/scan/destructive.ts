import type { ProseJudge } from "./context.ts";
import type { Finding, Severity } from "./index.ts";
import { bare, commandName } from "./interpreter.ts";
import {
  oncePerLine,
  patternMatch,
  statementMatch,
  strongestLine,
  type LineMatch,
} from "./line-match.ts";
import { strongest } from "./severity.ts";
import { skipWrappers, type Command, type Statement } from "./shell.ts";

// The idea of SC2114 and SC2115. No ShellCheck code is copied: ShellCheck is GPL-3.0.
const IMPORTANT_PATHS = new Set(
  "/ ~ $HOME ${HOME} /bin /boot /dev /etc /home /lib /lib64 /media /mnt /usr /usr/bin /usr/local /var /Users /System /Library".split(
    " ",
  ),
);
const UNGUARDED_VAR_DIR = /^\$\{?\w+\}?\/\*?$/u;

const isImportantTarget = (token: string): boolean => {
  const target = token.replaceAll(/["']/gu, "").replace(/(?<=.)[.,:]+$/u, "");
  return (
    UNGUARDED_VAR_DIR.test(target) || IMPORTANT_PATHS.has(target.replace(/\/\*?$/u, "") || "/")
  );
};

const RECURSIVE_DELETE =
  /\b(?<sudo>sudo(?:[ \t]+-\S*(?:[ \t]+[^\s-]\S*)??)*[ \t]+)?rm(?<flags>(?:[ \t]+--?[\w-]+)+)(?<targets>(?:[ \t]+[^\s;&|)`]+)*)/gu;

const deleteSeverity = (groups: Record<string, string | undefined> = {}): Severity | undefined => {
  const { sudo, flags = "", targets = "" } = groups;
  if (!/(?:^|\s)(?:-[a-zA-Z]*[rR]|--recursive\b)/u.test(flags)) return undefined;
  const important = targets.split(/\s+/u).filter(Boolean).some(isImportantTarget);
  return sudo || important ? "critical" : "info";
};

const FORK_BOMB =
  /(?<name>:|\b\w+)\s*\(\s*\)\s*\{\s*\k<name>\s*\|\s*\k<name>\s*&\s*\}\s*;\s*\k<name>/gu;

const ESCALATES = new Set(["sudo", "doas"]);
// Install guides run `sudo chmod +x` and `sudo tee` on their own files, so those only warn,
// unless they loosen a mode or touch the account and sudo files.
const AS_ROOT: Record<string, Severity> = {
  rm: "critical",
  dd: "critical",
  mkfs: "critical",
  chown: "critical",
  chmod: "warn",
  tee: "warn",
};
const ACCOUNT_FILE = /^\/etc\/(?:g?shadow|passwd|sudoers(?:\.d(?:\/.*)?)?)$/u;
const DISK = /^of=\/dev\/(?!(?:null|stdout|stderr|fd\/\S*)$)\S/u;
const OPEN_MODE = /^0?777$/u;
const SET_ID = /^[ugoa]*[+=][rwxXt]*s|^[246][0-7]{3}$/u;

const loosens = (mode: string): boolean =>
  OPEN_MODE.test(mode) || mode.split(",").some((clause) => SET_ID.test(clause));
const rootSeverity = (name: string, operands: string[]): Severity | undefined => {
  const severity = AS_ROOT[name];
  const [mode = ""] = operands;
  const loosened = name === "chmod" && loosens(mode);
  const accountFile = operands.some((path) => ACCOUNT_FILE.test(bare(path)));
  return severity === "warn" && (loosened || accountFile) ? "critical" : severity;
};

const FORCE = /^(?:--force|-[a-zA-Z]*f[a-zA-Z]*)$/u;

const warnIf = (match: boolean): Severity | undefined => (match ? "warn" : undefined);

const git = ([subcommand, ...args]: string[]): Severity | undefined => {
  if (subcommand === "push") return warnIf(args.some((arg) => arg === "--force" || arg === "-f"));
  if (subcommand === "reset") return warnIf(args.includes("--hard"));
  if (subcommand === "clean") return warnIf(args.some((arg) => FORCE.test(arg)));
  return undefined;
};

const CHECKS: Record<string, (args: string[], operands: string[]) => Severity | undefined> = {
  dd: (args) => (args.some((arg) => DISK.test(arg)) ? "critical" : undefined),
  mkfs: (_args, operands) => (operands.length > 0 ? "critical" : undefined),
  git: (args) => git(args),
  chmod: (args) => warnIf(loosens(args.find((arg) => !arg.startsWith("-")) ?? "")),
  history: (args) => warnIf(args.includes("-c")),
  rm: (_args, operands) => warnIf(operands.some((path) => /(?:^|\/)\.bash_history$/u.test(path))),
};

// Prose words after a command are operands only when they look like a path.
const operandsOf = (args: string[], prose: boolean): string[] =>
  args.filter((arg) => !arg.startsWith("-") && (!prose || /[./$~]/u.test(bare(arg))));

const commandSeverity = (
  { words, wrappers }: Pick<Command, "words" | "wrappers">,
  prose: boolean,
): Severity | undefined => {
  const [command = "", ...args] = words;
  const name = commandName(command).replace(/^mkfs\..+$/u, "mkfs");
  const operands = operandsOf(args, prose);
  const escalated = wrappers.some((wrapper) => ESCALATES.has(wrapper));
  const asRoot = escalated && operands.length > 0 ? rootSeverity(name, operands) : undefined;
  const own = CHECKS[name]?.(args, operands);
  return strongest([asRoot, own].flatMap((severity) => (severity ? [{ severity }] : [])))?.severity;
};

// Prose names the command after other words, as in "then run git reset --hard".
const candidates = (
  statement: Statement,
  command: Command,
): Pick<Command, "words" | "wrappers">[] =>
  statement.kind === "prose"
    ? [command, ...command.words.slice(1).map((_, i) => skipWrappers(command.words.slice(i + 1)))]
    : [command];

const statementMatches = (statements: Statement[], judge: ProseJudge): LineMatch[] =>
  statements.flatMap((statement) => {
    const prose = statement.kind === "prose";
    const found = statement.commands
      .flatMap((command) => candidates(statement, command))
      .map((candidate) => commandSeverity(candidate, prose))
      .filter((severity) => severity !== undefined);
    const best = strongest(found.map((severity) => ({ severity })));
    return best ? [statementMatch(statement, judge, best.severity)] : [];
  });

const patternMatches = (text: string, statements: Statement[], judge: ProseJudge): LineMatch[] => {
  const at = patternMatch(text, statements, judge);
  return [
    ...Array.from(text.matchAll(RECURSIVE_DELETE)).flatMap((match) => {
      const severity = deleteSeverity(match.groups);
      return severity ? [at(match.index, match[0].trim(), severity)] : [];
    }),
    ...Array.from(text.matchAll(FORK_BOMB), (match) => at(match.index, match[0], "critical")),
  ];
};

export const destructiveMatches = (
  text: string,
  statements: Statement[],
  judge: ProseJudge,
): LineMatch[] =>
  oncePerLine([...patternMatches(text, statements, judge), ...statementMatches(statements, judge)]);

export const destructive = (
  text: string,
  statements: Statement[],
  judge: ProseJudge,
): Pick<Finding, "severity" | "line" | "detail"> | undefined =>
  strongestLine(destructiveMatches(text, statements, judge));
