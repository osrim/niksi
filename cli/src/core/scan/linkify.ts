import { LinkifyIt } from "linkify-it";

// Fuzzy matching finds schemeless hosts, such as `evil.sh` after curl. linkify-it knows only the
// older generic domains, so `docs.acme.dev` needs `dev` and `app` added.
export const newLinkify = (): LinkifyIt =>
  new LinkifyIt({ fuzzyLink: true, fuzzyEmail: false, urlAuth: true }).tlds(["dev", "app"], true);
