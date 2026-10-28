import { extname, posix } from "node:path";
import type { SkillFile } from "./files.ts";
import { lineAt, stripFencedCode } from "./text.ts";

interface SkillMention {
  name: string;
  // Set when a Markdown link names an ambiguous skill.
  path?: string;
  file: string;
  line: number;
}

interface SkillRef {
  name: string;
  path: string;
  ambiguous?: boolean;
}

// A known skill without a path is mentioned by name only.
type KnownSkill = Omit<SkillRef, "path"> & { path?: string };

const SKILL_NAME = "[a-z][a-z0-9-]{1,63}";

// Exclude paths, closing tags, and slash-prefixed commands.
const STANDALONE_SLASH_MENTION = new RegExp(`(?:^|[^\\w/.<-])/(${SKILL_NAME})\\b`, "dgmu");

const NAMED_SKILL_CODE_MENTION = new RegExp(
  `\`/?(${SKILL_NAME})\`(?=[^\\n]{0,40}\\bskill\\b)`,
  "dgmu",
);

const HREF = String.raw`(?:<([^<>\n]*)>|([^\s<>()]+))`;
const TITLE = String.raw`(?:\s+(?:"[^"]*"|'[^']*'|\([^()]*\)))?`;

// `[text](href "title")`
const INLINE_LINK = new RegExp(String.raw`\]\(\s*${HREF}${TITLE}\s*\)`, "dgu");

// `[label]: href "title"`, on its own line.
const LINK_DEFINITION = new RegExp(
  String.raw`^ {0,3}\[([^\[\]\n]+)\]:[ \t]*\n?[ \t]*${HREF}${TITLE}[ \t]*$`,
  "dgmu",
);

// `[text][label]`, `[label][]`, or `[label]`.
const REFERENCE_LINK = /\[([^[\]\n]+)\](?:\[([^[\]\n]*)\])?(?!\()/gu;

const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/iu;

const targetSkillPath = (from: string, href: string): string | undefined => {
  const relativePath = href.replace(/[?#].*$/u, "");
  if (!relativePath || URL_SCHEME.test(relativePath) || relativePath.startsWith("/")) {
    return undefined;
  }
  const resolved = posix.join(from, relativePath).replace(/\/+$/u, "");
  const dir = posix.basename(resolved) === "SKILL.md" ? posix.dirname(resolved) : resolved;
  return dir === "." ? "" : dir;
};

const normalizeLabel = (label: string): string => label.trim().replace(/\s+/gu, " ").toLowerCase();

type Span = [number, number];

const hrefOf = (match: RegExpExecArray, group: number): string =>
  (match[group] ?? match[group + 1])!;

const hrefSpan = (match: RegExpExecArray, group: number): Span =>
  (match.indices![group] ?? match.indices![group + 1])!;

interface MarkdownLink {
  href: string;
  index: number;
}

const markdownLinks = (text: string): { links: MarkdownLink[]; hrefs: Span[] } => {
  const definitions = [...text.matchAll(LINK_DEFINITION)];
  const defined = new Map<string, string>();
  for (const match of definitions) {
    const label = normalizeLabel(match[1]!);
    if (label && !defined.has(label)) defined.set(label, hrefOf(match, 2));
  }
  const inDefinition = (index: number) =>
    definitions.some((match) => index >= match.index && index < match.index + match[0].length);
  const inline = [...text.matchAll(INLINE_LINK)];
  const references = [...text.matchAll(REFERENCE_LINK)].flatMap((match): MarkdownLink[] => {
    const href = defined.get(normalizeLabel(match[2] || match[1]!));
    return href === undefined || inDefinition(match.index) ? [] : [{ href, index: match.index }];
  });
  return {
    links: [
      ...inline.map((match) => ({ href: hrefOf(match, 1), index: match.index })),
      ...references,
    ],
    hrefs: [
      ...inline.map((match) => hrefSpan(match, 1)),
      ...definitions.map((match) => hrefSpan(match, 2)),
    ],
  };
};

interface Candidate {
  name: string;
  path?: string;
  index: number;
}

const namedCandidates = (text: string, names: Set<string>, hrefs: Span[]): Candidate[] => {
  const inHref = (match: RegExpExecArray) => {
    const [at] = match.indices![1]!;
    return hrefs.some(([start, end]) => at >= start && at < end);
  };
  return [STANDALONE_SLASH_MENTION, NAMED_SKILL_CODE_MENTION].flatMap((pattern) =>
    [...text.matchAll(pattern)]
      .filter((match) => names.has(match[1]!) && !inHref(match))
      .map((match) => ({ name: match[1]!, index: match.index })),
  );
};

const linkedCandidates = (
  links: MarkdownLink[],
  from: string,
  byPath: Map<string, KnownSkill>,
): Candidate[] =>
  links.flatMap(({ href, index }) => {
    const path = targetSkillPath(from, href);
    const skill = path === undefined ? undefined : byPath.get(path);
    if (path === undefined || skill === undefined) return [];
    return [skill.ambiguous ? { name: skill.name, path, index } : { name: skill.name, index }];
  });

// The first mention is cited, but a later Markdown link still pins an ambiguous skill.
const pinPath = (first: SkillMention, path: string | undefined): void => {
  if (first.path === undefined && path !== undefined) first.path = path;
};

export const findMentions = (
  files: SkillFile[],
  self: SkillRef,
  known: readonly KnownSkill[],
): SkillMention[] => {
  const names = new Set(known.map((skill) => skill.name));
  const byPath = new Map(
    known.flatMap((skill) => (skill.path === undefined ? [] : [[skill.path, skill] as const])),
  );
  const found = new Map<string, SkillMention>();
  for (const file of files) {
    if (extname(file.path).toLowerCase() !== ".md") continue;
    const text = stripFencedCode(file.content.toString("utf8"));
    const from = posix.join(self.path, posix.dirname(file.path));
    const { links, hrefs } = markdownLinks(text);
    const inOrder = [
      ...namedCandidates(text, names, hrefs),
      ...linkedCandidates(links, from, byPath),
    ].toSorted((a, b) => a.index - b.index);
    for (const { index, ...mention } of inOrder) {
      if (mention.name === self.name) continue;
      const first = found.get(mention.name);
      if (first) pinPath(first, mention.path);
      else found.set(mention.name, { ...mention, file: file.path, line: lineAt(text, index) });
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
      const first = missing.get(mention.name);
      if (first) pinPath(first, mention.path);
      else if (!inBatch.has(mention.name) && !alreadyHere(mention.name))
        missing.set(mention.name, { ...mention, from: skill.name });
    }
  }
  return [...missing.values()];
};

export interface Survivor extends BatchSkill {
  source: string;
}

export interface Target extends KnownSkill {
  source?: string;
}

// A Markdown link names a target only within the survivor's own source.
export const referrersTo = (survivors: Survivor[], targets: Target[]): Map<string, string[]> => {
  const leaving = new Set(targets.map((target) => target.name));
  const referrers = new Map<string, string[]>();
  for (const survivor of survivors) {
    if (leaving.has(survivor.name)) continue;
    const known = targets.map((target) =>
      target.source === survivor.source ? target : { name: target.name },
    );
    for (const mention of findMentions(survivor.files, survivor, known)) {
      referrers.set(mention.name, [...(referrers.get(mention.name) ?? []), survivor.name]);
    }
  }
  return new Map(
    [...leaving]
      .filter((target) => referrers.has(target))
      .map((target) => [target, referrers.get(target)!.toSorted()]),
  );
};
