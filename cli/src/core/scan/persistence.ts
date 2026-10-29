import type { ProseJudge } from "./context.ts";
import type { Finding, Severity } from "./index.ts";
import { excerpt } from "./redact.ts";
import { lower, strongest } from "./severity.ts";
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

const crontab = (args: string[]): Severity | undefined => {
  const flags = args.filter((arg, i) => args[i - 1] !== "-u" && arg !== "-u");
  if (flags.some((arg) => arg === "-l" || arg === "-r")) return "info";
  // A bare `crontab` reads the table from a pipe. In prose it is a word, not a command.
  return "critical";
};

const systemctl = (args: string[]): boolean =>
  /^(?:enable|link)$/u.test(args.find((arg) => !arg.startsWith("-")) ?? "");

const gitHooksPath = (args: string[]): boolean => {
  const at = args.findIndex((arg) => arg.toLowerCase() === "core.hookspath");
  return (
    args.includes("config") &&
    at !== -1 &&
    args[at + 1] !== undefined &&
    !args.some((arg) => /^--(?:get|unset|list)/u.test(arg))
  );
};

const PATHLIKE = /^-$|[./]/u;

const commandSeverity = (words: string[], piped: boolean, code: boolean): Severity | undefined => {
  const [command = "", ...args] = words;
  const sub = args[0] ?? "";
  switch (name(command).toLowerCase()) {
    case "crontab":
      // In prose, `crontab is a tool` is a sentence. A command takes a file, `-`, or a pipe.
      if (!code && !piped && !args.some((arg) => arg.startsWith("-") || PATHLIKE.test(arg))) {
        return undefined;
      }
      return crontab(args);
    case "launchctl":
      return /^(?:load|bootstrap|enable)$/u.test(sub) ? "critical" : undefined;
    case "systemctl":
      return systemctl(args) ? "critical" : undefined;
    case "schtasks":
      return args.some((arg) => /^[/-]create$/iu.test(arg)) ? "critical" : undefined;
    case "register-scheduledtask":
      return "critical";
    case "reg":
      return /^add$/iu.test(sub) && args.some((arg) => RUN_KEY.test(arg)) ? "critical" : undefined;
    case "new-itemproperty":
    case "set-itemproperty":
      return args.some((arg) => RUN_KEY.test(arg)) ? "critical" : undefined;
    case "git":
      return gitHooksPath(args) ? "critical" : undefined;
    case "@reboot":
      return "critical";
    default:
      return undefined;
  }
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
    PRELOAD.test(command.text) ? "critical" : undefined,
  ];
  return found.filter((severity): severity is Severity => severity !== undefined);
};

const DETAIL_LENGTH = 160;

export const persistence = (
  statements: Statement[],
  { afterProhibition, demoted }: ProseJudge,
): Pick<Finding, "severity" | "line" | "detail"> | undefined => {
  const found = statements.flatMap((statement) => {
    const prose = statement.kind === "prose";
    const prohibited = prose && afterProhibition(statement.index);
    const judge = (severity: Severity): Severity => {
      if (prohibited) return "info";
      const comment = statement.kind === "comment";
      return comment || (prose && demoted(statement.index)) ? lower(severity) : severity;
    };
    return statement.commands.flatMap((command, index) =>
      commandMatches(statement, command, index).map((severity) => ({
        statement,
        prohibited,
        severity: judge(severity),
      })),
    );
  });
  const best = strongest(found);
  if (!best) return undefined;
  const detail = [
    excerpt(best.statement.text, DETAIL_LENGTH),
    ...(best.prohibited ? ["(in a warning)"] : []),
    ...(found.length > 1 ? [`(${found.length} matches)`] : []),
  ].join(" ");
  return { severity: best.severity, line: best.statement.line, detail };
};
