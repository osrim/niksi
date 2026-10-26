import { extname, posix } from "node:path";
import type { SkillFile } from "./files.ts";
import { lineAt, stripFencedCode } from "./text.ts";

interface SkillMention {
  name: string;
  file: string;
  line: number;
}

interface SkillRef {
  name: string;
  path: string;
}

const SKILL_NAME = "[a-z][a-z0-9-]{1,63}";

// Exclude paths, closing tags, and slash-prefixed commands.
const STANDALONE_SLASH_MENTION = new RegExp(`(?:^|[^\\w/.<-])/(${SKILL_NAME})\\b`, "gmu");

const NAMED_SKILL_CODE_MENTION = new RegExp(
  `\`/?(${SKILL_NAME})\`(?=[^\\n]{0,40}\\bskill\\b)`,
  "gmu",
);

// `[text](target)`, with optional angle brackets and title.
const MARKDOWN_LINK = /\]\(\s*<?([^\s<>()]+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/gu;

const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/iu;

const targetSkillPath = (from: string, target: string): string | undefined => {
  const relativePath = target.replace(/[?#].*$/u, "");
  if (!relativePath || URL_SCHEME.test(relativePath) || relativePath.startsWith("/")) {
    return undefined;
  }
  const resolved = posix.join(from, relativePath).replace(/\/+$/u, "");
  const dir = posix.basename(resolved) === "SKILL.md" ? posix.dirname(resolved) : resolved;
  return dir === "." ? "" : dir;
};

interface Candidate {
  name: string | undefined;
  index: number;
}

const candidates = (
  text: string,
  pattern: RegExp,
  resolve: (capture: string) => string | undefined,
): Candidate[] =>
  [...text.matchAll(pattern)].map((m) => ({ name: resolve(m[1]!), index: m.index }));

export const findMentions = (
  files: SkillFile[],
  self: SkillRef,
  known: readonly SkillRef[],
): SkillMention[] => {
  const names = new Set(known.map((skill) => skill.name));
  const byPath = new Map(known.map((skill) => [skill.path, skill.name]));
  const named = (name: string) => (names.has(name) ? name : undefined);
  const found = new Map<string, SkillMention>();
  for (const file of files) {
    if (extname(file.path).toLowerCase() !== ".md") continue;
    const text = stripFencedCode(file.content.toString("utf8"));
    const from = posix.join(self.path, posix.dirname(file.path));
    const targeted = (target: string) => {
      const path = targetSkillPath(from, target);
      return path === undefined ? undefined : byPath.get(path);
    };
    const inOrder = [
      ...candidates(text, STANDALONE_SLASH_MENTION, named),
      ...candidates(text, NAMED_SKILL_CODE_MENTION, named),
      ...candidates(text, MARKDOWN_LINK, targeted),
    ].toSorted((a, b) => a.index - b.index);
    for (const { name, index } of inOrder) {
      if (name === undefined || name === self.name || found.has(name)) continue;
      found.set(name, { name, file: file.path, line: lineAt(text, index) });
    }
  }
  return [...found.values()].toSorted((a, b) => a.name.localeCompare(b.name));
};

export interface MissingDep extends SkillMention {
  from: string;
}

export interface BatchSkill extends SkillRef {
  files: SkillFile[];
}

export const missingDeps = (
  batch: BatchSkill[],
  known: readonly SkillRef[],
  alreadyHere: (name: string) => boolean,
): MissingDep[] => {
  const inBatch = new Set(batch.map((skill) => skill.name));
  const missing = new Map<string, MissingDep>();
  for (const skill of batch) {
    for (const mention of findMentions(skill.files, skill, known)) {
      if (inBatch.has(mention.name) || missing.has(mention.name) || alreadyHere(mention.name))
        continue;
      missing.set(mention.name, { ...mention, from: skill.name });
    }
  }
  return [...missing.values()];
};
