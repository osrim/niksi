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
  /^[\s\S]*?\b(?:in|into|to|within|on|as|at)\s+(?:\S+\s+){0,3}?(?:responses?|repl(?:y|ies)|outputs?|messages?|chat|summar(?:y|ies)|urls?|query strings?|logs?|images?|links?)\b/iu;

// What the verb routes must be a secret, or point back to one, as "the complete value" does.
const BACK_REFERENCE = /\b(?:it|them|the (?:\w+ )?values?)\b/iu;

// In "ask the user to paste their token in the chat" the user pastes: that asks, it does not route.
const USER_ACTS = /\b(?:user|them|they|you)\b[^.!?]{0,30}\bto\s+(?:\w+\s+(?:and|or)\s+)?$/iu;

const route = ({ index, text }: Sentence): Phrase | undefined => {
  for (const verb of text.matchAll(ROUTE)) {
    if (USER_ACTS.test(text.slice(0, verb.index))) continue;
    const routed = DESTINATION.exec(text.slice(verb.index + verb[0].length))?.[0];
    if (!routed || !(SECRET.test(routed) || BACK_REFERENCE.test(routed))) continue;
    return { index: index + verb.index, sentence: text, severity: "critical" };
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
