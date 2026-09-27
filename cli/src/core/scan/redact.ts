const MASK = "********";

const SECRET_QUERY_KEY = /^(.*token|.*key|.*secret|sig|signature|password|pass|auth)$/iu;

export const redact = (detail: string): string =>
  detail
    .replace(/(\b[a-z][\w+.-]*:\/\/[^\s/?#@:]*:)[^\s/?#@]+@/giu, `$1${MASK}@`)
    .replace(/([?&])([^\s=&#]+)=([^\s&#]+)/gu, (all, sep: string, key: string) =>
      SECRET_QUERY_KEY.test(key) ? `${sep}${key}=${MASK}` : all,
    )
    .replace(/\bbot(\d+):[\w-]+/gu, `bot$1:${MASK}`);
