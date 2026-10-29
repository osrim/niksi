import { domainToUnicode } from "node:url";
import { LinkifyIt } from "linkify-it";
import { lineAt } from "../skill/text.ts";
import type { Finding, Severity } from "./index.ts";
import { codeOf } from "./invisible.ts";
import { excerpt, matchDetail } from "./redact.ts";
import { strongest } from "./severity.ts";

const SCRIPTS = [
  ["Cyrillic", /\p{Script=Cyrillic}/u],
  ["Greek", /\p{Script=Greek}/u],
  ["Armenian", /\p{Script=Armenian}/u],
  ["Cherokee", /\p{Script=Cherokee}/u],
] as const;
const LOOKALIKE = new RegExp(
  `[${SCRIPTS.map(([script]) => String.raw`\p{Script=${script}}`).join("")}]`,
  "u",
);
const LATIN = /\p{Script=Latin}/u;
const WORD = /[\p{L}\p{M}]+/gu;
const PUNYCODE = /(?:^|[./])xn--/iu;
const HOST = /^(?:[a-z][\w+.-]*:\/\/)?(?:[^@/?#\s]*@)?([^/?#:\s]+)/iu;

const URL_LENGTH = 100;
const CODES = 3;

const linkify = new LinkifyIt({ fuzzyLink: true, fuzzyEmail: false, urlAuth: true });

interface Hit {
  index: number;
  severity: Severity;
  detail: string;
}

const mixedScripts = (word: string): string | undefined => {
  if (!LATIN.test(word)) return undefined;
  const others = [...word].filter((ch) => LOOKALIKE.test(ch));
  if (others.length === 0) return undefined;
  const [script] = SCRIPTS.find(([, pattern]) => pattern.test(others[0]!))!;
  const codes = [...new Set(others)].slice(0, CODES).map((ch) => codeOf(ch.codePointAt(0)!));
  return `"${word}" mixes Latin and ${script} (${codes.join(", ")})`;
};

const unicodeLabel = (label: string): string =>
  PUNYCODE.test(label) ? domainToUnicode(label) || label : label;

// A path word counts too: a GitHub owner such as `acme` names who serves the file.
const urlHit = (url: string, index: number): Hit | undefined => {
  const host = HOST.exec(url);
  if (!host) return undefined;
  const labels = host[1]!.split(".").map(unicodeLabel);
  const path = url.slice(host[0].length).split(/[?#]/u, 1)[0]!;
  const words = [...labels, ...(path.match(WORD) ?? [])];
  for (const word of words) {
    const mixed = mixedScripts(word);
    if (mixed)
      return { index, severity: "critical", detail: `${mixed} in ${excerpt(url, URL_LENGTH)}` };
  }
  if (!PUNYCODE.test(host[1]!)) return undefined;
  return { index, severity: "info", detail: `punycode host ${host[1]} reads ${labels.join(".")}` };
};

// `isCode` says whether the word at an index is code, such as a fence or a script.
export const confusableHost = (
  text: string,
  isCode: (index: number) => boolean,
): Pick<Finding, "severity" | "line" | "detail"> | undefined => {
  if (!LOOKALIKE.test(text) && !/xn--/iu.test(text)) return undefined;
  const urls = linkify.match(text) ?? [];
  // Words arrive in source order, so the URL cursor only moves forward.
  let next = 0;
  const inUrl = (index: number): boolean => {
    while (next < urls.length && urls[next]!.lastIndex <= index) next++;
    return next < urls.length && index >= urls[next]!.index;
  };
  const words = [...text.matchAll(WORD)].flatMap(({ 0: word, index }): Hit[] => {
    if (!isCode(index) || inUrl(index)) return [];
    const mixed = mixedScripts(word);
    return mixed ? [{ index, severity: "warn", detail: mixed }] : [];
  });
  const found = [...urls.flatMap((url) => urlHit(url.text, url.index) ?? []), ...words].toSorted(
    (a, b) => a.index - b.index,
  );
  const best = strongest(found);
  if (!best) return undefined;
  return {
    severity: best.severity,
    line: lineAt(text, best.index),
    detail: matchDetail(best.detail, false, found.length),
  };
};
