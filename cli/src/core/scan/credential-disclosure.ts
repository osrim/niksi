import type { ProseJudge } from "./context.ts";
import type { Finding } from "./index.ts";
import { reportPhrases, type Phrase, type Sentence } from "./prose.ts";

const SECRET =
  /\b(?:api[ _-]?keys?|tokens?|passwords?|passphrases?|secrets?|credentials?|private keys?|seed phrases?|otps?)\b/iu;

const SOLICIT = new RegExp(
  String.raw`\b(?:ask|prompt|request)(?:s|ed|ing)?\b[\s\S]*?\buser\b[\s\S]*?\b(?:for|to (?:provide|enter|paste|share))\b[\s\S]*?${SECRET.source}`,
  "iu",
);

const ROUTE =
  /\b(?:print|output|echo|include|paste|show|return|repeat|send|post|append|log)(?:s|ed|ing)?\b/giu;

const DESTINATION =
  /^[\s\S]*?\b(?:in|into|to|within|on|as|at)\s+(?:\S+\s+){0,3}?(?:responses?|repl(?:y|ies)|outputs?|messages?|chat|summar(?:y|ies)|urls?|query strings?|logs?|images?|links?)\b/iu;

// In "ask the user to paste their token in the chat" the user pastes: that asks, it does not route.
const USER_ACTS = /\b(?:user|them|they|you)\b[^.!?]{0,30}\bto\s+(?:\w+\s+(?:and|or)\s+)?$/iu;

const route = ({ index, text }: Sentence): Phrase | undefined => {
  for (const verb of text.matchAll(ROUTE)) {
    if (USER_ACTS.test(text.slice(0, verb.index))) continue;
    if (!DESTINATION.test(text.slice(verb.index + verb[0].length))) continue;
    return { index: index + verb.index, sentence: text, severity: "critical" };
  }
  return undefined;
};

const phrase = (sentence: Sentence): Phrase | undefined => {
  if (!SECRET.test(sentence.text)) return undefined;
  const solicit = SOLICIT.exec(sentence.text);
  return (
    route(sentence) ??
    (solicit
      ? { index: sentence.index + solicit.index, sentence: sentence.text, severity: "warn" }
      : undefined)
  );
};

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
