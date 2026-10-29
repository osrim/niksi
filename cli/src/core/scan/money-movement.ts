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
const GATE_BEFORE =
  /\b(?:ask|confirm|get (?:\S+\s+){0,2}?approval|wait for (?:approval|confirmation))\b[\s\S]*\bbefore\s+(?:\S+\s+){0,2}$/iu;
const GATE_AFTER =
  /^[\s\S]*?\bonly (?:after|with|once)\b[\s\S]{0,40}?\b(?:approv|confirm|consent)/iu;

const API =
  /\bstripe\.(?:payouts|transfers)\b|\/v1\/(?:payouts|transfers)\b|\beth_sendTransaction\b|\bweb3\.eth\.send\w*/gu;

const transfer = ({ index, text }: Sentence): Phrase | undefined => {
  if (!NOUN.test(text)) return undefined;
  const verb = [...text.matchAll(VERB)][0];
  if (!verb) return undefined;
  const before = text.slice(0, verb.index);
  const after = text.slice(verb.index + verb[0].length);
  let severity: Severity = "warn";
  if (GATE_BEFORE.test(before) || GATE_AFTER.test(after)) severity = "info";
  else if (QUALIFIER.test(text) || BYPASS.test(text)) severity = "critical";
  return { index: index + verb.index, sentence: text, severity };
};

// `text` is the whole file, where API names are read. `sentences` are its prose.
export const moneyMovement = (
  text: string,
  sentences: Sentence[],
  judge: ProseJudge,
): Pick<Finding, "severity" | "line" | "detail"> | undefined =>
  reportPhrases(
    text,
    [
      ...sentences.flatMap((sentence) => transfer(sentence) ?? []),
      ...[...text.matchAll(API)].map((match): Phrase => ({
        index: match.index,
        sentence: match[0],
        severity: "info",
      })),
    ],
    judge,
  );
