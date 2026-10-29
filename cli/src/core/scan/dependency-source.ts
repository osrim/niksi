import { judgeStatement, type ProseJudge } from "./context.ts";
import type { Finding, Severity } from "./index.ts";
import { isMap, keyIndex, keyLine, readJson } from "./manifest.ts";
import { matchDetail } from "./redact.ts";
import { strongest } from "./severity.ts";
import type { Command, Statement } from "./shell.ts";

const PYPI_HOSTS = new Set(["pypi.org", "files.pythonhosted.org"]);
const NPM_HOSTS = new Set(["registry.npmjs.org"]);

const INDEX_VARIABLE =
  /(?<![\w$])(?:\$env:)?(PIP_INDEX_URL|PIP_EXTRA_INDEX_URL|UV_INDEX_URL|NPM_CONFIG_REGISTRY)[ \t]*=[ \t]*["']?([^\s"';&|]+)/giu;
const PINNED = /(?:[@#]|\/archive\/)[\da-f]{40}(?:\.(?:tar\.gz|tgz|zip))?(?:#|$)/iu;
const CURL_INSECURE = /^(?:--insecure|-[a-zA-Z]*k[a-zA-Z]*)$/u;
const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];

// `value` flags take a value that says nothing about the source.
type FlagKind = "index" | "trusted" | "links" | "value";

interface Ecosystem {
  hosts: Set<string>;
  flags: Map<string, FlagKind>;
  installs: RegExp;
  source: RegExp;
  configKey: RegExp;
}

const PIP: Ecosystem = {
  hosts: PYPI_HOSTS,
  flags: new Map([
    ["--index-url", "index"],
    ["-i", "index"],
    ["--extra-index-url", "index"],
    ["--trusted-host", "trusted"],
    ["--find-links", "links"],
    ["-f", "links"],
    ["--log", "value"],
  ]),
  installs: /^install$/u,
  source: /(?:^|@\s*)(?:git\+|https?:\/\/)/iu,
  configKey: /^[\w-]+\.(?:extra-)?index-url$/u,
};

const NPM: Ecosystem = {
  hosts: NPM_HOSTS,
  flags: new Map([
    ["--registry", "index"],
    ["--location", "value"],
    ["-L", "value"],
    ["--prefix", "value"],
    ["--workspace", "value"],
    ["-w", "value"],
  ]),
  installs: /^(?:install|i|add|ci)$/u,
  source: /^(?:git\+|git:\/\/|https?:\/\/|github:|gitlab:|bitbucket:)/iu,
  configKey: /^(?:(?:@[\w.-]+:)?registry|npmRegistryServer)$/u,
};

const indexSeverity = (value: string, hosts: Set<string>): Severity | undefined => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "warn";
  }
  if (url.protocol === "http:") return "critical";
  if (url.protocol !== "https:") return "warn";
  return hosts.has(url.hostname.toLowerCase()) ? undefined : "critical";
};

const sourceSeverity = (value: string): Severity => (PINNED.test(value) ? "info" : "warn");

interface Option {
  kind: FlagKind;
  value: string;
}

const optionSeverity = ({ kind, value }: Option, hosts: Set<string>): Severity | undefined => {
  if (kind === "index") return indexSeverity(value, hosts);
  return kind === "value" ? undefined : "warn";
};

const flagOf = (
  arg: string,
  flags: Map<string, FlagKind>,
): [FlagKind, string | undefined] | undefined => {
  const eq = arg.indexOf("=");
  if (arg.startsWith("--") && eq !== -1) {
    const kind = flags.get(arg.slice(0, eq));
    return kind && [kind, arg.slice(eq + 1)];
  }
  const kind = flags.get(arg);
  if (kind) return [kind, undefined];
  const short = !arg.startsWith("--") && arg.length > 2 ? flags.get(arg.slice(0, 2)) : undefined;
  return short && [short, arg.slice(2)];
};

const readOptions = (
  args: string[],
  flags: Map<string, FlagKind>,
): { options: Option[]; operands: string[] } => {
  const options: Option[] = [];
  const operands: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    const flag = flagOf(arg, flags);
    if (!flag) {
      if (!arg.startsWith("-")) operands.push(arg);
      continue;
    }
    const value = flag[1] ?? args[++i];
    if (value !== undefined) options.push({ kind: flag[0], value });
  }
  return { options, operands };
};

// `npm config set registry URL`, `npm set registry=URL`, and `pip config set global.index-url URL`.
const configSeverity = (operands: string[], { hosts, configKey }: Ecosystem): Severity[] => {
  const set = operands.indexOf("set");
  if (set === -1 || (set > 0 && operands[set - 1] !== "config")) return [];
  const [first = "", second] = operands.slice(set + 1);
  const eq = first.indexOf("=");
  const [key, value] = eq === -1 ? [first, second] : [first.slice(0, eq), first.slice(eq + 1)];
  const severity = configKey.test(key) && value !== undefined && indexSeverity(value, hosts);
  return severity ? [severity] : [];
};

const packageSeverities = (ecosystem: Ecosystem, args: string[]): (Severity | undefined)[] => {
  const { options, operands } = readOptions(args, ecosystem.flags);
  const [subcommand = "", ...packages] = operands;
  if (!ecosystem.installs.test(subcommand)) return configSeverity(operands, ecosystem);
  return [
    ...options.map((option) => optionSeverity(option, ecosystem.hosts)),
    ...packages.filter((arg) => ecosystem.source.test(arg)).map(sourceSeverity),
  ];
};

const commandName = (word: string): string => word.replace(/^.*[\\/]/u, "").toLowerCase();

const PIP_COMMAND = /^pip[\d.]*$/u;

const ecosystemOf = ([command = "", ...args]: string[]): [Ecosystem, string[]] | undefined => {
  const name = commandName(command);
  if (PIP_COMMAND.test(name) || name === "pipx") return [PIP, args];
  if (/^(?:npm|pnpm|yarn|bun)$/u.test(name)) return [NPM, args];
  if (/^(?:python[\d.]*|py)$/u.test(name) && args[0] === "-m" && PIP_COMMAND.test(args[1] ?? "")) {
    return [PIP, args.slice(2)];
  }
  return name === "uv" && args[0] === "pip" ? [PIP, args.slice(1)] : undefined;
};

const insecure = (words: string[]): boolean => {
  const [command = "", ...args] = words;
  const name = commandName(command);
  if (name === "curl") return args.some((arg) => CURL_INSECURE.test(arg));
  return name === "wget" && args.includes("--no-check-certificate");
};

const commandSeverities = (words: string[]): (Severity | undefined)[] => {
  const ecosystem = ecosystemOf(words);
  if (ecosystem) return packageSeverities(...ecosystem);
  return insecure(words) ? ["warn"] : [];
};

const variableSeverities = (command: Command): (Severity | undefined)[] =>
  [...command.text.matchAll(INDEX_VARIABLE)].map(([, variable = "", value = ""]) =>
    indexSeverity(value, variable.toUpperCase() === "NPM_CONFIG_REGISTRY" ? NPM_HOSTS : PYPI_HOSTS),
  );

interface Match {
  severity: Severity;
  line: number | undefined;
  text: string;
  quiet: boolean;
}

const statementMatches = (statements: Statement[], judge: ProseJudge): Match[] =>
  statements.flatMap((statement) => {
    const { quiet, judged } = judgeStatement(statement, judge);
    return statement.commands
      .flatMap((command) => [...commandSeverities(command.words), ...variableSeverities(command)])
      .filter((severity) => severity !== undefined)
      .map((severity) => ({
        severity: judged(severity),
        line: statement.line,
        text: statement.text,
        quiet,
      }));
  });

const manifestMatches = (text: string): Match[] => {
  const manifest = readJson(text);
  if (manifest instanceof Error) return [];
  return DEPENDENCY_FIELDS.flatMap((field) => {
    const dependencies = manifest[field];
    if (!isMap(dependencies)) return [];
    const from = keyIndex(text, field);
    return Object.entries(dependencies).flatMap(([dependency, value]) =>
      typeof value === "string" && NPM.source.test(value)
        ? [
            {
              severity: sourceSeverity(value),
              line: keyLine(text, dependency, Math.max(from, 0)),
              text: `${field} ${dependency}: ${value}`,
              quiet: false,
            },
          ]
        : [],
    );
  });
};

export const dependencySource = (
  statements: Statement[],
  judge: ProseJudge,
  packageJson?: string,
): Pick<Finding, "severity" | "line" | "detail"> | undefined => {
  const found = [
    ...statementMatches(statements, judge),
    ...(packageJson === undefined ? [] : manifestMatches(packageJson)),
  ];
  const best = strongest(found);
  if (!best) return undefined;
  return {
    severity: best.severity,
    ...(best.line === undefined ? {} : { line: best.line }),
    detail: matchDetail(best.text, best.quiet, found.length),
  };
};
