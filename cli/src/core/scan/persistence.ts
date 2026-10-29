import { judgeStatement, type ProseJudge } from "./context.ts";
import type { Finding, Severity } from "./index.ts";
import { matchDetail } from "./redact.ts";
import { strongest } from "./severity.ts";
import { mapHome, type Command, type Statement } from "./shell.ts";

// Paths are matched after mapHome, so `~` stands for every home spelling.
const LOCATION = new RegExp(
  [
    String.raw`^\/etc\/(?:cron\.\w+|crontab)(?![\w-])`,
    String.raw`^\/var\/spool\/cron(?![\w-])`,
    String.raw`(?:^|\/)Library\/Launch(?:Agents|Daemons)(?:\/|$)`,
    String.raw`^\/etc\/systemd\/system(?:\/|$)`,
    String.raw`^~\/\.config\/systemd\/user(?:\/|$)`,
    String.raw`(?:^|\/)\.git\/hooks\/(?![\w-]+\.sample$)[\w-]+$`,
    String.raw`^\/etc\/ld\.so\.preload$`,
  ].join("|"),
  "u",
);

const AUTHORIZED_KEYS = /^~\/\.ssh\/authorized_keys2?$/u;
const START_FILE =
  /(?:^|\/)(?:\.bashrc|\.zshrc|\.profile|\.bash_profile|\.zprofile|\.zshenv|config\.fish)$/u;
const FETCHES = /\/tmp\b|(?<![\w-])(?:curl|wget)(?![\w-])|\bhttps?:\/\//iu;
const PRELOAD = /(?:^|\s)(?:export\s+)?(?:LD_PRELOAD|DYLD_INSERT_LIBRARIES)=/u;
const RUN_KEY = /\\CurrentVersion\\Run(?:Once)?\b/iu;

const REDIRECT = /^(?:\d|&)?>(>?)(.*)$/u;
const COPIES = new Set(["cp", "mv", "install", "ln", "rsync"]);

interface Write {
  path: string;
  append: boolean;
}

const name = (word: string): string => word.replace(/^.*[\\/]/u, "").replace(/\.exe$/iu, "");

const unquote = (word: string): string => word.replaceAll(/["'`]/gu, "");

// Prose splits words without quotes, so `'x' >> ~/.zshrc` still finds the redirect.
const writes = (words: string[]): Write[] => {
  const found: Write[] = [];
  const [command = "", ...args] = words;
  for (let i = 0; i < words.length; i++) {
    const redirect = REDIRECT.exec(words[i]!);
    if (!redirect) continue;
    const target = redirect[2] || words[++i];
    if (target) found.push({ path: unquote(target), append: redirect[1] === ">" });
  }
  const operands = args.filter((arg) => !arg.startsWith("-") && !REDIRECT.test(arg));
  if (name(command) === "tee") {
    const append = args.some((arg) => arg === "-a" || arg === "--append");
    found.push(...operands.map((path) => ({ path: unquote(path), append })));
  }
  if (COPIES.has(name(command)) && operands.length > 1) {
    found.push({ path: unquote(operands.at(-1)!), append: false });
  }
  return found;
};

const crontab = (args: string[]): Severity => {
  const flags = args.filter((arg, i) => args[i - 1] !== "-u" && arg !== "-u");
  return flags.some((arg) => arg === "-l" || arg === "-r") ? "info" : "critical";
};

const PATHLIKE = /^-|[./]/u;

const gitHooksPath = (args: string[]): boolean => {
  const at = args.findIndex((arg) => arg.toLowerCase() === "core.hookspath");
  const reads = args.some((arg) => /^--(?:get|unset|list)/u.test(arg));
  return args.includes("config") && at !== -1 && args[at + 1] !== undefined && !reads;
};

interface Use {
  args: string[];
  // Input arrives from a pipe, as in `printf … | crontab -`.
  piped: boolean;
  code: boolean;
}

const critical = (installs: boolean): Severity | undefined => (installs ? "critical" : undefined);

const COMMANDS: Record<string, (use: Use) => Severity | undefined> = {
  // In prose, "crontab is a tool" is a sentence. A command takes a flag, a file, `-`, or a pipe.
  crontab: ({ args, piped, code }) =>
    code || piped || args.some((arg) => PATHLIKE.test(arg)) ? crontab(args) : undefined,
  launchctl: ({ args }) => critical(/^(?:load|bootstrap|enable)$/u.test(args[0] ?? "")),
  systemctl: ({ args }) =>
    critical(/^(?:enable|link)$/u.test(args.find((arg) => !arg.startsWith("-")) ?? "")),
  schtasks: ({ args }) => critical(args.some((arg) => /^[/-]create$/iu.test(arg))),
  "register-scheduledtask": () => "critical",
  git: ({ args }) => critical(gitHooksPath(args)),
  "@reboot": () => "critical",
};

const commandSeverity = (words: string[], piped: boolean, code: boolean): Severity | undefined => {
  const [command = "", ...args] = words;
  return COMMANDS[name(command).toLowerCase()]?.({ args, piped, code });
};

const writeSeverity = ({ path, append }: Write, statement: Statement): Severity | undefined => {
  if (LOCATION.test(path) || (append && AUTHORIZED_KEYS.test(path))) return "critical";
  if (!START_FILE.test(path)) return undefined;
  return FETCHES.test(mapHome(statement.text).replace(path, "")) ? "critical" : "warn";
};

const commandMatches = (statement: Statement, command: Command, index: number): Severity[] => {
  const code = statement.kind !== "prose";
  const found = [
    commandSeverity(command.words, index > 0, code),
    ...writes(command.words).map((write) => writeSeverity(write, statement)),
    PRELOAD.test(command.text) || RUN_KEY.test(command.text) ? "critical" : undefined,
  ];
  return found.filter((severity): severity is Severity => severity !== undefined);
};

export interface PersistenceMatch {
  severity: Severity;
  line: number;
  statement: Statement;
  quiet: boolean;
}

export const persistenceMatches = (
  statements: Statement[],
  judge: ProseJudge,
): PersistenceMatch[] =>
  statements.flatMap((statement) => {
    const { quiet, judged } = judgeStatement(statement, judge);
    return statement.commands.flatMap((command, index) =>
      commandMatches(statement, command, index).map((severity) => ({
        severity: judged(severity),
        line: statement.line,
        statement,
        quiet,
      })),
    );
  });

export const persistence = (
  statements: Statement[],
  judge: ProseJudge,
): Pick<Finding, "severity" | "line" | "detail"> | undefined => {
  const found = persistenceMatches(statements, judge);
  const best = strongest(found);
  if (!best) return undefined;
  return {
    severity: best.severity,
    line: best.line,
    detail: matchDetail(best.statement.text, best.quiet, found.length),
  };
};
