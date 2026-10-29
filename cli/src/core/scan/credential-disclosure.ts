import type { ProseJudge } from "./context.ts";
import type { Finding } from "./index.ts";
import { reportPhrases, type Phrase, type Sentence } from "./prose.ts";

const SECRET =
  /\b(?:api[ _-]?keys?|tokens?|passwords?|passphrases?|secrets?|credentials?|private keys?|seed phrases?|otps?)\b/iu;

const SOLICIT = [
  /\b(?:ask|prompt|request)(?:s|ed|ing)?\b/giu,
  /\buser\b/giu,
  /\b(?:for|to (?:provide|enter|paste|share))\b/giu,
  new RegExp(SECRET.source, "giu"),
];

const ROUTE =
  /\b(?:print|output|echo|include|paste|show|return|repeat|send|post|append|log)(?:s|ed|ing)?\b/giu;

const DESTINATION =
  /\b(?:in|into|to|within|on|as|at)\s+(?:\S+\s+){0,3}?(?:responses?|repl(?:y|ies)|outputs?|messages?|chat|summar(?:y|ies)|urls?|query strings?|logs?|images?|links?)\b/giu;

// What the verb routes must be a secret, or point back to one, as "the complete value" does.
const BACK_REFERENCE = /\b(?:it|them|the (?:\w+ )?values?)\b/iu;

// In "ask the user to paste their token in the chat" the user pastes: that asks, it does not route.
const USER_ACTS = /\b(?:user|them|they|you)\b[^.!?]{0,30}\bto\s+(?:\w+\s+(?:and|or)\s+)?$/iu;

// The user acts in the few words before the verb, so a short window keeps the scan linear.
const USER_WINDOW = 200;
const NON_WORD = /\W/iu;

const userActs = (text: string, verb: number): boolean => {
  if (verb <= USER_WINDOW) return USER_ACTS.test(text.slice(0, verb));
  const window = text.slice(verb - USER_WINDOW, verb);
  // The window starts after a non-word character, so it cannot cut a word into a match.
  const cut = NON_WORD.exec(window);
  return cut !== null && USER_ACTS.test(window.slice(cut.index + 1));
};

// Verbs share the next destination until one passes it, so the sentence is searched once.
const destinationAfter = (text: string): ((from: number) => RegExpExecArray | null) => {
  let next: RegExpExecArray | null | undefined;
  return (from) => {
    if (next === undefined || (next !== null && next.index < from)) {
      DESTINATION.lastIndex = from;
      next = DESTINATION.exec(text);
    }
    return next;
  };
};

// A verb that routes nothing to a destination clears every later verb with the same destination.
const route = ({ index, text }: Sentence): Phrase | undefined => {
  const destination = destinationAfter(text);
  let clearedEnd = -1;
  for (const verb of text.matchAll(ROUTE)) {
    const after = verb.index + verb[0].length;
    const found = destination(after);
    if (!found) return undefined;
    const end = found.index + found[0].length;
    if (end === clearedEnd || userActs(text, verb.index)) continue;
    const routed = text.slice(after, end);
    if (SECRET.test(routed) || BACK_REFERENCE.test(routed)) {
      return { index: index + verb.index, sentence: text, severity: "critical" };
    }
    clearedEnd = end;
  }
  return undefined;
};

// Each word is found at its earliest place after the one before, so hostile text scans in linear time.
const solicit = ({ index, text }: Sentence): Phrase | undefined => {
  let from = 0;
  let start = -1;
  for (const word of SOLICIT) {
    word.lastIndex = from;
    const match = word.exec(text);
    if (!match) return undefined;
    if (start < 0) start = match.index;
    from = match.index + match[0].length;
  }
  return { index: index + start, sentence: text, severity: "warn" };
};

const phrase = (sentence: Sentence): Phrase | undefined =>
  SECRET.test(sentence.text) ? (route(sentence) ?? solicit(sentence)) : undefined;

export const credentialDisclosure = (
  text: string,
  sentences: Sentence[],
  judge: ProseJudge,
): Pick<Finding, "severity" | "line" | "detail"> | undefined =>
  reportPhrases(
    text,
    sentences.flatMap((sentence) => phrase(sentence) ?? []),
    judge,
  );
