import { mapMarkdown, type Span } from "../skill/markdown.ts";

export const HOME = "~";

const HOME_SPELLING =
  /\$\{HOME\}|\$HOME(?!\w)|%USERPROFILE%|\$env:(?:USERPROFILE|HOME)(?!\w)|(?<![\w.~/\\-])(?:[A-Za-z]:\\Users|\/Users|\/home)[\\/][^\\/\s"'`;|&<>()]+/giu;

export const mapHome = (text: string): string => text.replaceAll(HOME_SPELLING, HOME);

// Code is a script line or a code block line, prose is other Markdown text and inline code.
export type StatementKind = "code" | "comment" | "prose";

export interface Substitution {
  kind: "$(" | "<(";
  body: string;
}

export interface Command {
  text: string;
  // Unquoted, with wrappers and leading assignments skipped and home spellings mapped.
  words: string[];
  // The skipped wrappers, such as `sudo` and `nohup`.
  wrappers: string[];
  substitutions: Substitution[];
}

export interface Statement {
  kind: StatementKind;
  line: number;
  // Offset of the statement in the scanned text. Exact for prose, the first line for code.
  index: number;
  text: string;
  commands: Command[];
  // Ended by a single `&`.
  background: boolean;
}

const WRAPPERS = new Map<string, Set<string>>([
  ["sudo", new Set(["-u", "-g", "-C", "-D", "-h", "-p", "-R", "-r", "-T", "-t", "-U"])],
  ["doas", new Set(["-u", "-C"])],
  ["env", new Set(["-u", "-C"])],
  ["nohup", new Set()],
  ["setsid", new Set()],
  ["time", new Set(["-f", "-o"])],
  ["xargs", new Set(["-a", "-d", "-E", "-I", "-L", "-n", "-P", "-s"])],
]);

const ASSIGNMENT = /^[A-Za-z_]\w*=/u;

export const skipWrappers = (words: string[]): Pick<Command, "words" | "wrappers"> => {
  const wrappers: string[] = [];
  let i = 0;
  while (i < words.length) {
    const word = words[i]!;
    if (ASSIGNMENT.test(word)) {
      i++;
      continue;
    }
    const takesValue = WRAPPERS.get(word);
    if (!takesValue) break;
    wrappers.push(word);
    i++;
    while (words[i]?.startsWith("-")) i += takesValue.has(words[i]!) ? 2 : 1;
  }
  return { words: words.slice(i), wrappers };
};

interface Frame {
  close: string;
  start: number;
  kind?: Substitution["kind"];
}

interface Draft {
  start: number;
  text: string;
  commands: Command[];
  background: boolean;
}

interface Splitter {
  text: string;
  shell: boolean;
  drafts: Draft[];
  stack: Frame[];
  commands: Command[];
  words: string[];
  substitutions: Substitution[];
  word: string | undefined;
  statementStart: number;
  commandStart: number;
}

const OPENERS: Record<string, Substitution["kind"] | undefined> = { "$(": "$(", "<(": "<(" };

// A Windows path such as C:\Users\ada keeps its backslashes: only these characters are escaped.
const ESCAPABLE = /[\s"'`$\\|&;<>()#*?[\]{}!~]/u;

const touch = (s: Splitter, i: number): void => {
  if (s.statementStart < 0) s.statementStart = i;
  if (s.commandStart < 0) s.commandStart = i;
  s.word ??= "";
};

const append = (s: Splitter, chars: string, i: number): void => {
  touch(s, i);
  s.word += chars;
};

const endWord = (s: Splitter): void => {
  if (s.word !== undefined) s.words.push(s.word);
  s.word = undefined;
};

const endCommand = (s: Splitter, end: number): void => {
  endWord(s);
  if (s.commandStart >= 0) {
    const { words, wrappers } = skipWrappers(s.words);
    s.commands.push({
      text: s.text.slice(s.commandStart, end).trim(),
      words: words.map(mapHome),
      wrappers,
      substitutions: s.substitutions,
    });
  }
  s.words = [];
  s.substitutions = [];
  s.commandStart = -1;
};

const endStatement = (s: Splitter, end: number, background = false): void => {
  endCommand(s, end);
  if (s.commands.length > 0) {
    s.drafts.push({
      start: s.statementStart,
      text: s.text.slice(s.statementStart, end).trim(),
      commands: s.commands,
      background,
    });
  }
  s.commands = [];
  s.statementStart = -1;
};

// A quote that opens or closes at the top level is dropped from the word.
const open = (s: Splitter, frame: Frame, chars: string, i: number): void => {
  if (s.stack.length === 0 && !frame.kind) touch(s, i);
  else append(s, chars, i);
  s.stack.push(frame);
};

const close = (s: Splitter, chars: string, i: number): void => {
  const frame = s.stack.pop()!;
  if (s.stack.length === 0 && !frame.kind) touch(s, i);
  else append(s, chars, i);
  if (frame.kind && !s.stack.some((outer) => outer.kind)) {
    s.substitutions.push({ kind: frame.kind, body: s.text.slice(frame.start, i) });
  }
};

// Returns the last index it consumed, or undefined when `ch` opens nothing.
const opening = (s: Splitter, ch: string, i: number, inDouble: boolean): number | undefined => {
  const pair = s.text.slice(i, i + 2);
  const kind = OPENERS[pair];
  if (kind && !(inDouble && kind === "<(")) {
    open(s, { close: ")", start: i + 2, kind }, pair, i);
    return i + 1;
  }
  if (pair === ">(" && !inDouble) {
    open(s, { close: ")", start: i + 2 }, pair, i);
    return i + 1;
  }
  if (!s.shell) return undefined;
  if (ch === "`") {
    open(s, { close: "`", start: i + 1, kind: "$(" }, ch, i);
    return i;
  }
  if ((ch === "'" || ch === '"') && !inDouble) {
    open(s, { close: ch, start: i + 1 }, ch, i);
    return i;
  }
  return undefined;
};

const nested = (s: Splitter, ch: string, i: number): number => {
  const top = s.stack.at(-1)!;
  if (top.close === "'" && ch !== "'") append(s, ch, i);
  else if (ch === top.close) close(s, ch, i);
  else if (ch === "(" && top.close === ")") open(s, { close: ")", start: i + 1 }, ch, i);
  else return opening(s, ch, i, top.close === '"') ?? (append(s, ch, i), i);
  return i;
};

const endsStatement = (s: Splitter, i: number): boolean => {
  const next = s.text[i + 1];
  return !/[<>]/u.test(s.text[i - 1] ?? "") && (next === undefined || /\s/u.test(next));
};

const topLevel = (s: Splitter, ch: string, i: number): number | "comment" => {
  const next = s.text[i + 1];
  if (/\s/u.test(ch)) endWord(s);
  else if (s.shell && ch === "#" && s.word === undefined) return "comment";
  else if (ch === ";") endStatement(s, i);
  else if (ch === "&" && next !== "&" && endsStatement(s, i)) endStatement(s, i, true);
  else if ((ch === "&" || ch === "|") && next === ch) {
    endStatement(s, i);
    return i + 1;
  } else if (ch === "|") {
    endCommand(s, i);
    return next === "&" ? i + 1 : i;
  } else return opening(s, ch, i, false) ?? (append(s, ch, i), i);
  return i;
};

const escape = (s: Splitter, i: number): number | undefined => {
  const next = s.text[i + 1];
  if (!s.shell || s.text[i] !== "\\" || s.stack.at(-1)?.close === "'") return undefined;
  if (next === undefined || !ESCAPABLE.test(next)) return undefined;
  append(s, s.stack.length === 0 ? next : `\\${next}`, i);
  return i + 1;
};

// Splits one logical line into statements. Shell text honors quotes, escapes, backticks and `#`.
const split = (text: string, shell: boolean): { drafts: Draft[]; commentAt?: number } => {
  const s: Splitter = {
    text,
    shell,
    drafts: [],
    stack: [],
    commands: [],
    words: [],
    substitutions: [],
    word: undefined,
    statementStart: -1,
    commandStart: -1,
  };
  for (let i = 0; i < text.length; i++) {
    const escaped = escape(s, i);
    if (escaped !== undefined) {
      i = escaped;
      continue;
    }
    const ch = text[i]!;
    const consumed = s.stack.length > 0 ? nested(s, ch, i) : topLevel(s, ch, i);
    if (consumed === "comment") {
      endStatement(s, i);
      return { drafts: s.drafts, commentAt: i + 1 };
    }
    i = consumed;
  }
  endStatement(s, text.length);
  return { drafts: s.drafts };
};

interface Segment {
  text: string;
  line: number;
  index: number;
}

const segmentStatements = (segment: Segment, shell: boolean, kind: StatementKind): Statement[] => {
  if (shell && kind !== "comment" && /^\s*\/\//u.test(segment.text)) {
    const at = segment.text.indexOf("//") + 2;
    return segmentStatements(
      { ...segment, text: segment.text.slice(at), index: segment.index + at },
      true,
      "comment",
    );
  }
  const { drafts, commentAt } = split(segment.text, shell);
  const statements = drafts.map((draft): Statement => ({
    kind,
    line: segment.line,
    index: segment.index + draft.start,
    text: draft.text,
    commands: draft.commands,
    background: draft.background,
  }));
  if (commentAt === undefined) return statements;
  const rest = {
    ...segment,
    text: segment.text.slice(commentAt),
    index: segment.index + commentAt,
  };
  return [...statements, ...segmentStatements(rest, true, "comment")];
};

const linesOf = (text: string): Segment[] => {
  let index = 0;
  return text.split("\n").map((line, i) => {
    const entry = { text: line, line: i + 1, index };
    index += line.length + 1;
    return entry;
  });
};

const CONTINUED = /(?<!\\)(?:\\\\)*\\$/u;
const COMMENT_LINE = /^\s*(?:#|\/\/)/u;

// A comment runs to the end of its line, so a backslash inside one does not continue it.
const endsInComment = (text: string): boolean =>
  COMMENT_LINE.test(text) || split(text, true).commentAt !== undefined;

const codeSegments = (lines: Segment[]): Segment[] => {
  const segments: Segment[] = [];
  let current: Segment | undefined;
  for (const { text, line, index } of lines) {
    if (current) current.text += text.trimStart();
    else current = { text, line, index };
    if (CONTINUED.test(text) && !endsInComment(current.text)) {
      current.text = current.text.slice(0, -1);
      continue;
    }
    segments.push(current);
    current = undefined;
  }
  return current ? [...segments, current] : segments;
};

const TABLE_ROW = /^\s*\|/u;

// A table row's pipes separate cells, so only its inline code is shell text.
const proseSegments = ({ text, line, index }: Segment, inline: Span[]): Segment[] => {
  const end = index + text.length;
  const spans: Segment[] = [];
  let rest = text;
  for (const span of inline.filter((s) => s.start < end && s.end > index)) {
    const from = Math.max(span.start, index) - index;
    const to = Math.min(span.end, end) - index;
    spans.push({ text: text.slice(from, to), line, index: index + from });
    let first = from;
    let past = to;
    while (text[first - 1] === "`") first--;
    while (text[past] === "`") past++;
    rest = rest.slice(0, first) + ";".padEnd(past - first) + rest.slice(past);
  }
  return TABLE_ROW.test(text) ? spans : [{ text: rest, line, index }, ...spans];
};

const markdownStatements = (text: string): Statement[] => {
  const lines = linesOf(text);
  const map = mapMarkdown(text);
  const statements: Statement[] = [];
  for (const block of map.codeBlocks) {
    const body = lines.slice(block.line - 1, block.line - 1 + block.lines);
    for (const segment of codeSegments(body)) {
      statements.push(...segmentStatements(segment, true, "code"));
    }
  }
  const inline = map.spans("inline");
  for (const line of lines.filter((segment) => !map.isCode(segment.index))) {
    for (const segment of proseSegments(line, inline)) {
      statements.push(...segmentStatements(segment, false, "prose"));
    }
  }
  return statements;
};

export const shellStatements = (text: string, markdown: boolean): Statement[] =>
  (markdown
    ? markdownStatements(text)
    : codeSegments(linesOf(text)).flatMap((segment) => segmentStatements(segment, true, "code"))
  ).toSorted((a, b) => a.index - b.index);
