export const EXEC_SINK = String.raw`(?<![.\w])(?:eval|exec)\s*\(`;

const SHELLS = String.raw`(?:ba|z|da|k|a|fi)?sh`;
export const EVALUATORS = String.raw`iex|invoke-expression`;
const INTERPRETERS = String.raw`${SHELLS}|python[\d.]*|node|bun|deno|perl|ruby|php|osascript|pwsh|powershell|${EVALUATORS}`;
const SHELL = new RegExp(`^${SHELLS}$`, "u");
export const INTERPRETER = new RegExp(`^(?:${INTERPRETERS})$`, "iu");
const EVALUATOR = new RegExp(`^(?:${EVALUATORS})$`, "iu");
export const RUNS_ARGUMENT = /^(?:eval|source|\.|exec)$/u;
const RUN_SUBCOMMAND = /^(?:bun|deno)$/iu;
const SHELL_CODE_FLAG = /^-[a-zA-Z]*c[a-zA-Z]*$/u;
const SHELL_STDIN_FLAG = /^-[a-zA-Z]*s[a-zA-Z]*$/u;
const CODE_FLAG = /^-(?:c|e|m|r|p|-eval|-print|command)$/iu;

export const bare = (word: string): string =>
  word
    .replace(/^[(!"'`]+/u, "")
    .replace(/[,:;!?)"'`]+$/u, "")
    .replace(/(?<=.)\.$/u, "");

export const commandName = (word: string): string => bare(word).replace(/^.*\//u, "") || bare(word);

export const isCodeFlag = (name: string, word: string): boolean =>
  (SHELL.test(name) ? SHELL_CODE_FLAG : CODE_FLAG).test(word);

// `bun run x.ts` and `deno run -A x.ts` name the script after the `run` subcommand.
export const scriptOperand = (name: string, args: string[]): string | undefined =>
  (RUN_SUBCOMMAND.test(name) && args[0] === "run" ? args.slice(1) : args).find(
    (arg) => !arg.startsWith("-"),
  );

// Prose words after an interpreter are not arguments unless they look like a path.
export const runsStdin = (words: string[], prose: boolean): boolean => {
  const [command = "", ...args] = words;
  const name = commandName(command);
  if (!INTERPRETER.test(name)) return false;
  if (EVALUATOR.test(name)) return true;
  if (SHELL.test(name)) {
    if (args.some((arg) => SHELL_STDIN_FLAG.test(arg))) return true;
    // xargs supplies the command string after a trailing -c.
    if (SHELL_CODE_FLAG.test(args.at(-1) ?? "")) return true;
  }
  if (args.some((arg) => isCodeFlag(name, arg))) return false;
  const script = scriptOperand(name, args);
  return script === undefined || (prose && !/[./]/u.test(script));
};
