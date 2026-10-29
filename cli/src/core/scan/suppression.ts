import { lineAt } from "../skill/text.ts";
import type { Finding } from "./index.ts";
import { matchDetail } from "./redact.ts";

// The skill author is the party under review, so the scan reports these and never honours them.
const SUPPRESSION =
  /gitleaks:allow|pragma:[ \t]*allowlist[ \t]+secret|#[ \t]*nosec\b|shellcheck[ \t]+disable=|eslint-disable|\bnoqa\b/giu;

export const suppressionComments = (
  text: string,
): Pick<Finding, "severity" | "line" | "detail"> | undefined => {
  const found = [...text.matchAll(SUPPRESSION)];
  const first = found[0];
  if (!first) return undefined;
  return {
    severity: "info",
    line: lineAt(text, first.index),
    detail: matchDetail(first[0], false, found.length),
  };
};
