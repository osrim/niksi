import type { Finding, Severity } from "./index.ts";
import { lower, strongest } from "./severity.ts";
import { mapHome, type Command, type Statement } from "./shell.ts";

// Paths are matched after mapHome, so `~` stands for every home spelling.
const END = String.raw`(?![\w-]|\.[\w-])`;
const UNDER = String.raw`(?![\w-])(?:[\\/][\w.*-]*)?`;
const STORE = new RegExp(
  [
    String.raw`~[\\/]\.(?:ssh|aws|azure|gnupg|password-store)${UNDER}`,
    String.raw`~[\\/]\.config[\\/]gcloud${UNDER}`,
    String.raw`~[\\/]\.(?:git-credentials|netrc|pgpass|npmrc|pypirc)${END}`,
    String.raw`~[\\/]\.docker[\\/]config\.json(?![\w-])`,
    String.raw`~[\\/]\.kube[\\/]config${END}`,
    String.raw`(?<![\w.-])application_default_credentials\.json`,
    String.raw`(?<![\w.-])\/etc\/(?:g?shadow|sudoers(?:\.d)?)${END}`,
    String.raw`\bsecurity[ \t]+(?:find-(?:generic|internet)-password|dump-keychain)\b`,
    String.raw`\bLibrary[\\/]Keychains\b`,
    String.raw`(?<=[\\/])(?:Login(?:\\ | )Data|Cookies)${END}`,
    String.raw`(?<![\w.-])(?:key4\.db|logins\.json|cookies\.sqlite)(?![\w-])`,
  ].join("|"),
  "gu",
);

const PUBLIC_SSH = /[\\/]\.ssh[\\/](?:.*\.pub|authorized_keys|known_hosts(?:\.old)?)$/u;

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
  "export",
]);

const WRITES_TO = /(?:>>?|\btee(?:[ \t]+-[\w-]+)*)[ \t]*["']?$/u;

const IN_URL = /[a-z][\w+.-]*:\/\/\S*$/iu;

interface Match {
  severity: Severity;
  path: string;
}

export interface ProseJudge {
  afterProhibition: (index: number) => boolean;
  demoted: (index: number) => boolean;
}

const commandName = (command: Command): string => (command.words[0] ?? "").replace(/^.*\//u, "");

const privateSeverity = (statement: Statement, command: Command, text: string): Severity => {
  if (READS.test(text)) return "critical";
  if (statement.kind !== "code" || MANAGES.has(commandName(command))) return "warn";
  return "critical";
};

const commandMatches = (statement: Statement, command: Command, setup: boolean): Match[] => {
  const text = mapHome(command.text);
  return [...text.matchAll(STORE)].flatMap((match) => {
    const before = text.slice(0, match.index);
    if (IN_URL.test(before)) return [];
    const path = match[0].replace(/(?<=.)[.,:;]+$/u, "");
    const publicPath = setup || PUBLIC_SSH.test(path) || WRITES_TO.test(before);
    const severity = publicPath
      ? "warn"
      : privateSeverity(statement, command, mapHome(statement.text));
    return [{ severity, path }];
  });
};

// Prose names a store, a read verb beside it reads it, and code reads it unless it only manages it.
export const credentialPaths = (
  statements: Statement[],
  { afterProhibition, demoted }: ProseJudge,
): Pick<Finding, "severity" | "line" | "detail"> | undefined => {
  const found = statements.flatMap((statement) => {
    const setup = KEY_SETUP.test(statement.text);
    const quiet = statement.kind === "prose" && afterProhibition(statement.index);
    const drop = statement.kind === "prose" && demoted(statement.index);
    return statement.commands.flatMap((command) =>
      commandMatches(statement, command, setup).map((match) => ({
        path: match.path,
        line: statement.line,
        quiet,
        severity: quiet ? "info" : drop ? lower(match.severity) : match.severity,
      })),
    );
  });
  const best = strongest(found);
  if (!best) return undefined;
  const detail = [
    best.path,
    ...(best.quiet ? ["(in a warning)"] : []),
    ...(found.length > 1 ? [`(${found.length} matches)`] : []),
  ].join(" ");
  return { severity: best.severity, line: best.line, detail };
};
