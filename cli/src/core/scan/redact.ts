import { maskSecrets } from "./secret-patterns.ts";

const MASK = "********";

const SECRET_QUERY_KEY = /^(.*token|.*key|.*secret|sig|signature|password|pass|auth)$/iu;

export const redact = (detail: string): string =>
  maskSecrets(detail, MASK)
    .replace(/(\b[a-z][\w+.-]*:\/\/[^\s/?#@:]*:)[^\s/?#@]+@/giu, `$1${MASK}@`)
    .replace(/([?&])([^\s=&#]+)=([^\s&#]+)/gu, (all, sep: string, key: string) =>
      SECRET_QUERY_KEY.test(key) ? `${sep}${key}=${MASK}` : all,
    )
    .replace(/\bbot(\d+):[\w-]+/gu, `bot$1:${MASK}`);

// The window holds the longest token a rule masks, a 1019-character PyPI token, past the cut.
const WINDOW_MARGIN = 1024;

// A cut URL credential has lost the "@" that redact needs to find it.
const CUT_URL_CREDENTIAL = /(\b[a-z][\w+.-]*:\/\/[^\s/?#@:]*:)[^\s/?#@]+$/iu;

// Quoted file text stays on one line and cannot move the cursor or reorder what follows.
// Secrets are masked in a bounded window before the cut, so a long text still scans in linear time.
export const excerpt = (text: string, max: number): string => {
  const flat = text
    .trim()
    .replaceAll(/\s+/gu, " ")
    .replaceAll(/[\p{Cc}\p{Cf}\p{Co}\p{Cn}]/gu, "\u{FFFD}");
  const window = flat.slice(0, max + WINDOW_MARGIN);
  const masked = redact(window);
  if (window.length === flat.length && masked.length <= max) return masked;
  return `${masked.slice(0, max).replace(CUT_URL_CREDENTIAL, `$1${MASK}`)}…`;
};

const DETAIL_LENGTH = 160;

export const matchDetail = (text: string, quiet: boolean, count: number): string =>
  [
    excerpt(text, DETAIL_LENGTH),
    ...(quiet ? ["(in a warning)"] : []),
    ...(count > 1 ? [`(${count} matches)`] : []),
  ].join(" ");
