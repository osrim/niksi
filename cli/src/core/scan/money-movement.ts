import type { ProseJudge } from "./context.ts";
import type { Finding, Severity } from "./index.ts";
import { BYPASS } from "./prompt-injection.ts";
import { reportPhrases, type Phrase, type Sentence } from "./prose.ts";

const VERB =
  /\b(?:transfer(?:s|red|ring)?|send(?:s|ing)?|sent|mov(?:e|es|ed|ing)|withdr(?:aw|aws|awing|awn|ew)|wir(?:e|es|ed|ing)|pa(?:y|ys|ying|id) out|sweep(?:s|ing)?|swept|drain(?:s|ed|ing)?|liquidat(?:e|es|ed|ing))\b/giu;

const MONEY = String.raw`(?:funds?|money|balances?|payments?|wallets?|crypto|bitcoin|btc|eth|usdc|usdt)`;

// "Send the customer a payment receipt" names a document about money, not money.
const ABOUT_MONEY = String.raw`(?:receipts?|confirmations?|links?|details|status|methods?|pages?|forms?|notifications?|reminders?|history|summar(?:y|ies)|reports?|emails?|records?|intents?|info(?:rmation)?|data|webhooks?|events?|updates?|address(?:es)?|sheets?|requests?|options?|providers?|gateways?|terms|plans?|schedules?|screens?)`;

const NOUN = new RegExp(String.raw`\b${MONEY}\b(?!\s+${ABOUT_MONEY}\b)`, "iu");

const QUALIFIER = new RegExp(
  String.raw`\b(?:full|entire|all|whole|remaining|maximum)\s+(?:(?:of|the|your|their|my|our|its|available|account|wallet|current)\s+){0,3}${MONEY}\b|\b0x[0-9a-fA-F]{40}\b|\bbc1[a-z0-9]{25,}\b`,
  "iu",
);

// Cisco's skill-scanner treats "only after user approval" as a gate (active_remote_execution.py, 4f8bec3).
const ASKS = [
  /\b(?:ask|confirm)\b/iu,
  /\bget (?:\S+\s+){0,2}?approval\b/iu,
  /\bwait for (?:approval|confirmation)\b/iu,
];
const BEFORE = /^([\s\S]*)\bbefore\s+(?:\S+\s+){0,2}$/iu;
const GATE_AFTER =
  /^[\s\S]*?\bonly (?:after|with|once)\b[\s\S]{0,40}?\b(?:approv|confirm|consent)/iu;

const API =
  /\bstripe\.(?:payouts|transfers)\b|\/v1\/(?:payouts|transfers)\b|\beth_sendTransaction\b|\bweb3\.eth\.send\w*/gu;

const firstAskEnd = (text: string): number =>
  Math.min(
    ...ASKS.map((pattern) => {
      const ask = pattern.exec(text);
      return ask ? ask.index + ask[0].length : Infinity;
    }),
  );

// "before" sits at most two words ahead of the verb, so a short window keeps the scan linear.
const BEFORE_WINDOW = 100;

const gatedBefore = (text: string, verb: number, asked: number): boolean => {
  const from = Math.max(verb - BEFORE_WINDOW, 0);
  const before = BEFORE.exec(text.slice(from, verb));
  return before !== null && asked <= from + before[1]!.length;
};

// A verb's clause runs to the next verb, so approval asked for one transfer does not cover another.
const transfers = ({ index, text }: Sentence): Phrase[] => {
  const verbs = [...text.matchAll(VERB)];
  const asked = firstAskEnd(text);
  return verbs.flatMap((verb, i) => {
    const end = verbs[i + 1]?.index ?? text.length;
    const clause = text.slice(i === 0 ? 0 : verb.index, end);
    if (!NOUN.test(clause)) return [];
    const after = text.slice(verb.index + verb[0].length, end);
    let severity: Severity = "warn";
    if (gatedBefore(text, verb.index, asked) || GATE_AFTER.test(after)) severity = "info";
    else if (QUALIFIER.test(clause) || BYPASS.test(clause)) severity = "critical";
    return [{ index: index + verb.index, sentence: text, severity }];
  });
};

// API names are read in the whole text, transfers in its prose sentences.
export const moneyPhrases = (text: string, sentences: Sentence[]): Phrase[] => [
  ...sentences.flatMap(transfers),
  ...[...text.matchAll(API)].map((match): Phrase => ({
    index: match.index,
    sentence: match[0],
    severity: "info",
  })),
];

export const moneyMovement = (
  text: string,
  sentences: Sentence[],
  judge: ProseJudge,
): Pick<Finding, "severity" | "line" | "detail"> | undefined =>
  reportPhrases(text, moneyPhrases(text, sentences), judge);
