import type { ProseJudge } from "./context.ts";
import type { Finding, Severity } from "./index.ts";
import { lower, strongest } from "./severity.ts";
import { mapHome, type Command, type Statement } from "./shell.ts";

// Paths are matched after mapHome, so `~` stands for every home spelling.
const PATH_END = String.raw`(?![\w-]|\.[\w-])`;
const UNDER = String.raw`(?![\w-])(?:[\\/][\w.*-]*)*`;
const CREDENTIAL_LOCATION = new RegExp(
  [
    String.raw`~[\\/]\.(?:ssh|aws|azure|gnupg|password-store)${UNDER}`,
    String.raw`~[\\/]\.config[\\/]gcloud${UNDER}`,
    String.raw`~[\\/]\.(?:git-credentials|netrc|pgpass|npmrc|pypirc)${PATH_END}`,
    String.raw`~[\\/]\.docker[\\/]config\.json(?![\w-])`,
    String.raw`~[\\/]\.kube[\\/]config${PATH_END}`,
    String.raw`(?<![\w.-])application_default_credentials\.json`,
    String.raw`(?<![\w.-])\/etc\/(?:g?shadow|sudoers(?:\.d)?)${PATH_END}`,
    String.raw`\bsecurity[ \t]+(?:find-(?:generic|internet)-password|dump-keychain)\b`,
    String.raw`\bLibrary[\\/]Keychains\b`,
    String.raw`(?<=[\\/])(?:Login(?:\\ | )Data|Cookies)${PATH_END}`,
    String.raw`(?<![\w.-])(?:key4\.db|logins\.json|cookies\.sqlite)(?![\w-])`,
  ].join("|"),
  "gu",
);

const PUBLIC_SSH = /^~[\\/]\.ssh[\\/](?:.*\.pub|authorized_keys|known_hosts(?:\.old)?)$/u;

const READS =
  /(?<![\w-])(?:cat|head|tail|less|cp|scp|rsync|tar|zip|base64|xxd|curl)(?![\w-])|\bopen\(|\breadFile(?:Sync)?\b|\bread_text\b/u;

const KEY_SETUP = /(?<![\w-])ssh-(?:keygen|copy-id)(?![\w-])/u;

// These commands manage a credential file or point a tool at it. They do not read it out.
const MANAGES = new Set([
  "ssh",
  "ssh-add",
  "ssh-keyscan",
  "chmod",
  "chown",
  "mkdir",
  "touch",
  "ls",
  "cd",
  "export",
]);

const COMMAND_WORDS = new RegExp(
  [
    READS.source,
    String.raw`(?<![\w-])(?:${[...MANAGES].join("|")})(?![\w-])`,
    KEY_SETUP.source,
  ].join("|"),
  "gu",
);

const WRITES_TO = /(?:>>?|\btee(?:[ \t]+-[\w-]+)*)[ \t]*["']?$/u;

// A substitution inside a URL still reads the file, as in `?d=$(<~/.ssh/id_rsa)`.
const IN_URL = /[a-z][\w+.-]*:\/\/[^\s$`<(]*$/iu;

const TRAILING = new Set([".", ",", ":", ";"]);

// Drops trailing punctuation but keeps the first character. A regex anchored with `$` would
// retry the run from each of its positions, which is quadratic in a long run of dots.
const trimTrailing = (path: string): string => {
  let end = path.length;
  while (end > 1 && TRAILING.has(path.charAt(end - 1))) end -= 1;
  return path.slice(0, end);
};

interface Match {
  severity: Severity;
  path: string;
  // Where a prohibition before the path counts.
  at: number;
}

const commandName = (command: Command): string => (command.words[0] ?? "").replace(/^.*\//u, "");

const privateSeverity = (statement: Statement, command: Command, text: string): Severity => {
  if (READS.test(text)) return "critical";
  if (statement.kind !== "code" || MANAGES.has(commandName(command))) return "warn";
  return "critical";
};

const wordStarts = (text: string): number[] =>
  Array.from(text.matchAll(COMMAND_WORDS), (match) => match.index);

// Prose names the command after other words, as in "Do not run cat ~/.ssh/id_rsa", so a
// prohibition counts at the last command word before the path, as it does before a code span.
// Paths are found in the text after mapHome, which shortens home spellings, so the word is found
// by its count in the command as written. Paths arrive in text order, so the count only grows.
const commandWordBefore = (command: Command, mapped: string): ((path: number) => number) => {
  const mappedStarts = wordStarts(mapped);
  const rawStarts = wordStarts(command.text);
  let seen = 0;
  return (path) => {
    while (seen < mappedStarts.length && mappedStarts[seen]! < path) seen++;
    return command.index + (seen === 0 ? 0 : (rawStarts[seen - 1] ?? 0));
  };
};

const commandMatches = (statement: Statement, command: Command, setup: boolean): Match[] => {
  const text = mapHome(command.text);
  const wordBefore = commandWordBefore(command, text);
  return [...text.matchAll(CREDENTIAL_LOCATION)].flatMap((match) => {
    const before = text.slice(0, match.index);
    if (IN_URL.test(before)) return [];
    const path = trimTrailing(match[0]);
    const publicPath = setup || PUBLIC_SSH.test(path) || WRITES_TO.test(before);
    const severity = publicPath
      ? "warn"
      : privateSeverity(statement, command, mapHome(statement.text));
    return [{ severity, path, at: wordBefore(match.index) }];
  });
};

const lowerIf = (lowered: boolean, severity: Severity): Severity =>
  lowered ? lower(severity) : severity;

export const credentialPaths = (
  statements: Statement[],
  { afterProhibition, demoted }: ProseJudge,
): Pick<Finding, "severity" | "line" | "detail"> | undefined => {
  const found = statements.flatMap((statement) => {
    const prose = statement.kind === "prose";
    return statement.commands.flatMap((command) =>
      commandMatches(statement, command, KEY_SETUP.test(command.text)).map(
        ({ path, severity, at }) => {
          const prohibited = prose && afterProhibition(at);
          const lowered = prose && demoted(at);
          return {
            path,
            line: statement.line,
            prohibited,
            severity: prohibited ? "info" : lowerIf(lowered, severity),
          };
        },
      ),
    );
  });
  const best = strongest(found);
  if (!best) return undefined;
  const detail = [
    best.path,
    ...(best.prohibited ? ["(in a warning)"] : []),
    ...(found.length > 1 ? [`(${found.length} matches)`] : []),
  ].join(" ");
  return { severity: best.severity, line: best.line, detail };
};
