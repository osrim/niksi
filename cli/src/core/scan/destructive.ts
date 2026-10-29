import { lineAt } from "../skill/text.ts";
import { oncePerLine } from "./combine.ts";
import { judgeIndex, judgeStatement, type ProseJudge } from "./context.ts";
import type { Finding, Severity } from "./index.ts";
import { bare, commandName } from "./interpreter.ts";
import { matchDetail } from "./redact.ts";
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
const AS_ROOT = new Set(["rm", "dd", "mkfs", "chmod", "chown", "tee"]);
const DISK = /^of=\/dev\/(?!(?:null|stdout|stderr|fd\/\S*)$)\S/u;
const OPEN_MODE = /^0?777$/u;
const SET_ID = /^[ugoa]*[+=][rwxXt]*s|^[246][0-7]{3}$/u;
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
  chmod: (_args, [mode = ""]) => warnIf(OPEN_MODE.test(mode) || SET_ID.test(mode)),
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
  if (escalated && AS_ROOT.has(name) && operands.length > 0) return "critical";
  return CHECKS[name]?.(args, operands);
};

// Prose names the command after other words, as in "then run git reset --hard".
const candidates = (
  statement: Statement,
  command: Command,
): Pick<Command, "words" | "wrappers">[] =>
  statement.kind === "prose"
    ? [command, ...command.words.slice(1).map((_, i) => skipWrappers(command.words.slice(i + 1)))]
    : [command];

export interface DestructiveMatch {
  severity: Severity;
  line: number;
  index: number;
  text: string;
  quiet: boolean;
}

const statementMatches = (statements: Statement[], judge: ProseJudge): DestructiveMatch[] =>
  statements.flatMap((statement) => {
    const prose = statement.kind === "prose";
    const found = statement.commands
      .flatMap((command) => candidates(statement, command))
      .map((candidate) => commandSeverity(candidate, prose))
      .filter((severity) => severity !== undefined);
    const best = strongest(found.map((severity) => ({ severity })));
    if (!best) return [];
    const { quiet, judged } = judgeStatement(statement, judge);
    const { line, index, text } = statement;
    return [{ severity: judged(best.severity), line, index, text, quiet }];
  });

const patternMatches = (
  text: string,
  statements: Statement[],
  judge: ProseJudge,
): DestructiveMatch[] => {
  const located = (index: number, found: string, severity: Severity): DestructiveMatch => {
    const { quiet, judged } = judgeIndex(statements, index, judge);
    return { severity: judged(severity), line: lineAt(text, index), index, text: found, quiet };
  };
  return [
    ...[...text.matchAll(RECURSIVE_DELETE)].flatMap((match) => {
      const severity = deleteSeverity(match.groups);
      return severity ? [located(match.index, match[0].trim(), severity)] : [];
    }),
    ...[...text.matchAll(FORK_BOMB)].map((match) => located(match.index, match[0], "critical")),
  ];
};

// A line can match both as a statement and as a pattern, so each line counts once.
export const destructiveMatches = (
  text: string,
  statements: Statement[],
  judge: ProseJudge,
): DestructiveMatch[] =>
  oncePerLine(
    [...patternMatches(text, statements, judge), ...statementMatches(statements, judge)].toSorted(
      (a, b) => a.index - b.index,
    ),
  );

export const destructive = (
  text: string,
  statements: Statement[],
  judge: ProseJudge,
): Pick<Finding, "severity" | "line" | "detail"> | undefined => {
  const found = destructiveMatches(text, statements, judge);
  const best = strongest(found);
  if (!best) return undefined;
  return {
    severity: best.severity,
    line: best.line,
    detail: matchDetail(best.text, best.quiet, found.length),
  };
};
