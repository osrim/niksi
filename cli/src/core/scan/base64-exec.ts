import type { ProseJudge } from "./context.ts";
import type { Finding } from "./index.ts";
import {
  commandName,
  EXEC_SINK,
  INTERPRETER,
  isCodeFlag,
  RUNS_ARGUMENT,
  runsStdin,
} from "./interpreter.ts";
import {
  oncePerLine,
  patternMatch,
  statementMatch,
  strongestLine,
  type LineMatch,
} from "./line-match.ts";
import { shellStatements, type Command, type Statement } from "./shell.ts";

const DECODER = String.raw`b64decode|base64_decode|base64\.decode(?:bytes|string)|atob\s*\(|Buffer\.from\([^\n]*?["']base64["']|base64[ \t]+(?:-d|-D|--decode)\b|codecs\.decode\s*\(|bytes\.fromhex\s*\(|zlib\.decompress\s*\(|marshal\.loads\s*\(|(?<![.\w])compile\s*\(|["']{2}\.join\(\s*(?:map\(\s*chr\b|\[?\s*chr\s*\()|String\.fromCharCode\s*\(`;
const SINK = String.raw`${EXEC_SINK}|\bnew[ \t]+Function\s*\(|(?<![.\w])eval[ \t]+["'$\x60]|\|[ \t]*(?:ba|z|da)?sh\b`;

const PATTERNS = [
  new RegExp(`(?:${DECODER})[^\\n]*?(?:${SINK})|(?:${SINK})[^\\n]*?(?:${DECODER})`, "gu"),
  /\bgetattr\s*\([^)\n]*["']\s*\+\s*["'][^)\n]*\)\s*\(/gu,
  /\b__import__\s*\(\s*["']os["']\s*\)\s*\.\s*system\s*\(/gu,
];

const HEX_ESCAPE = /\\x[\da-f]{2}/iu;

// Each check asks only whether some argument matches, so a decoder that fails at one
// start also fails at every later start of the same name, which sees fewer arguments.
const DECODERS: Record<string, (args: string[]) => boolean> = {
  base64: (args) => args.some((arg) => /^(?:-[a-zA-Z]*[dD][a-zA-Z]*|--decode)$/u.test(arg)),
  xxd: (args) => args.some((arg) => /^-(?:[ps]*r[ps]*|revert)$/u.test(arg)),
  openssl: (args) => args.includes("-d"),
  printf: (args) => args.some((arg) => HEX_ESCAPE.test(arg)),
  echo: (args) =>
    args.some((arg) => /^-[a-zA-Z]*e/u.test(arg)) && args.some((arg) => HEX_ESCAPE.test(arg)),
  rev: () => true,
  gunzip: () => true,
};

const OPENSSL_DECODES = /^(?:enc|base64)$/u;

interface Decoder {
  name: string;
  check: (args: string[]) => boolean;
  argsFrom: number;
}

// openssl decodes only through its enc and base64 subcommands, so its name includes one.
const decoderAt = (words: string[], i: number): Decoder | undefined => {
  const command = commandName(words[i] ?? "");
  const check = Object.hasOwn(DECODERS, command) ? DECODERS[command] : undefined;
  if (check === undefined) return undefined;
  if (command !== "openssl") return { name: command, check, argsFrom: i + 1 };
  const subcommand = words[i + 1] ?? "";
  return OPENSSL_DECODES.test(subcommand)
    ? { name: `openssl ${subcommand}`, check, argsFrom: i + 2 }
    : undefined;
};

const decodesAt = (words: string[], decoder: Decoder | undefined): boolean =>
  decoder?.check(words.slice(decoder.argsFrom)) ?? false;

// Prose names the command after other words, as in "decode it with xxd -r | sh".
// Trying each decoder name from its first start only keeps a long line linear.
const decodesInProse = (words: string[]): boolean => {
  const tried = new Set<string>();
  return words.some((_, i) => {
    const decoder = decoderAt(words, i);
    if (decoder === undefined || tried.has(decoder.name)) return false;
    tried.add(decoder.name);
    return decodesAt(words, decoder);
  });
};

const decodes = (words: string[], prose: boolean): boolean =>
  prose ? decodesInProse(words) : decodesAt(words, decoderAt(words, 0));

const decodesInside = (body: string): boolean =>
  shellStatements(body, false).some((statement) =>
    statement.commands.some((command) => decodes(command.words, false)),
  );

const runsSubstitution = ({ words, substitutions }: Command): boolean => {
  const [first = "", ...args] = words;
  const name = commandName(first);
  const runs = (kind: string): boolean =>
    /^["'`]?(?:\$\(|`)/u.test(first) ||
    RUNS_ARGUMENT.test(name) ||
    (INTERPRETER.test(name) && (kind === "<(" || args.some((arg) => isCodeFlag(name, arg))));
  return substitutions.some((sub) => runs(sub.kind) && decodesInside(sub.body));
};

const decodesAndRuns = (statement: Statement): boolean => {
  const prose = statement.kind === "prose";
  const { commands } = statement;
  const decoder = commands.findIndex((command) => decodes(command.words, prose));
  if (decoder !== -1 && commands.slice(decoder + 1).some((c) => runsStdin(c.words, prose))) {
    return true;
  }
  return commands.some(runsSubstitution);
};

const statementMatches = (statements: Statement[], judge: ProseJudge): LineMatch[] =>
  statements
    .filter(decodesAndRuns)
    .map((statement) => statementMatch(statement, judge, "critical"));

const patternMatches = (text: string, statements: Statement[], judge: ProseJudge): LineMatch[] => {
  const at = patternMatch(text, statements, judge);
  return PATTERNS.flatMap((pattern) =>
    Array.from(text.matchAll(pattern), (match) => at(match.index, match[0], "critical")),
  );
};

export const base64ExecMatches = (
  text: string,
  statements: Statement[],
  judge: ProseJudge,
): LineMatch[] =>
  oncePerLine([...statementMatches(statements, judge), ...patternMatches(text, statements, judge)]);

export const base64Exec = (
  text: string,
  statements: Statement[],
  judge: ProseJudge,
): Pick<Finding, "severity" | "line" | "detail"> | undefined =>
  strongestLine(base64ExecMatches(text, statements, judge));
