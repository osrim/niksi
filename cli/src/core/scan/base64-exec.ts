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

const DECODERS: Record<string, (args: string[]) => boolean> = {
  base64: (args) => args.some((arg) => /^(?:-[a-zA-Z]*[dD][a-zA-Z]*|--decode)$/u.test(arg)),
  xxd: (args) => args.some((arg) => /^-(?:[ps]*r[ps]*|revert)$/u.test(arg)),
  openssl: (args) => /^(?:enc|base64)$/u.test(args[0] ?? "") && args.includes("-d"),
  printf: (args) => args.some((arg) => HEX_ESCAPE.test(arg)),
  echo: (args) =>
    args.some((arg) => /^-[a-zA-Z]*e/u.test(arg)) && args.some((arg) => HEX_ESCAPE.test(arg)),
  rev: () => true,
  gunzip: () => true,
};

const decodesAt = (words: string[]): boolean => {
  const [command = "", ...args] = words;
  return DECODERS[commandName(command)]?.(args) ?? false;
};

// Prose names the command after other words, as in "decode it with xxd -r | sh".
const decodes = (words: string[], prose: boolean): boolean =>
  prose ? words.some((_, i) => decodesAt(words.slice(i))) : decodesAt(words);

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
