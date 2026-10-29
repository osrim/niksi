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

// Quoted file text stays on one line and cannot move the cursor or reorder what follows.
export const excerpt = (text: string, max: number): string => {
  const flat = text
    .trim()
    .replaceAll(/\s+/gu, " ")
    .replaceAll(/[\p{Cc}\p{Cf}\p{Co}\p{Cn}]/gu, "\u{FFFD}");
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
};
