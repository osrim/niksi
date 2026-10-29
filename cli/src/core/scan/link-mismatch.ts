import { LinkifyIt } from "linkify-it";
import MarkdownIt from "markdown-it";
import type { Finding, Severity } from "./index.ts";
import { matchDetail } from "./redact.ts";
import { strongest } from "./severity.ts";

const markdown = new MarkdownIt();

type Token = ReturnType<typeof markdown.parse>[number];

// linkify-it knows only the older generic domains, so `docs.acme.dev` needs `dev` added.
const linkify = new LinkifyIt({ fuzzyLink: true, fuzzyEmail: false }).tlds(["dev", "app"], true);

// Without a scheme or a path, these name a file that shares its extension with a country domain.
const FILE_NAME = /^[^/]+\.(?:md|sh|py|pl|pm|rs|ps|mk|ml|tf|so|cc|in)$/iu;

const RUNS_SCRIPT = /\.(?:sh|py|ps1)$/iu;

interface Link {
  label: string;
  href: string;
  line: number;
}

const markdownLinks = (tokens: Token[]): Link[] => {
  const links: Link[] = [];
  for (const token of tokens) {
    if (token.type !== "inline" || !token.map || !token.children) continue;
    let line = token.map[0] + 1;
    let open: Link | undefined;
    for (const child of token.children) {
      if (child.type === "softbreak" || child.type === "hardbreak") line++;
      if (child.type === "link_open" && child.markup !== "autolink") {
        open = { label: "", href: String(child.attrGet("href") ?? ""), line };
      } else if (child.type === "link_close" && open) {
        links.push(open);
        open = undefined;
      } else if (open && (child.type === "text" || child.type === "code_inline")) {
        open.label += child.content;
      }
    }
  }
  return links;
};

const hostOf = (url: string): string | undefined => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./u, "") || undefined;
  } catch {
    return undefined;
  }
};

// The label is a host only when the whole of it is one URL or bare host.
const labelHost = (label: string): string | undefined => {
  const text = label.trim();
  const found = linkify.match(text) ?? [];
  const [match] = found;
  if (found.length !== 1 || match!.index !== 0 || match!.lastIndex !== text.length)
    return undefined;
  if (match!.schema === "" && FILE_NAME.test(text)) return undefined;
  return hostOf(match!.url);
};

const related = (a: string, b: string): boolean =>
  a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);

interface Mismatch extends Link {
  severity: Severity;
}

export const linkMismatch = (
  text: string,
  isExfil: (url: string) => boolean,
): Pick<Finding, "severity" | "line" | "detail"> | undefined => {
  const found = markdownLinks(markdown.parse(text, {})).flatMap((link): Mismatch[] => {
    const shown = labelHost(link.label);
    const target = hostOf(link.href);
    if (!shown || !target || related(shown, target)) return [];
    const runs = RUNS_SCRIPT.test(new URL(link.href).pathname);
    return [{ ...link, severity: runs || isExfil(link.href) ? "critical" : "warn" }];
  });
  const best = strongest(found);
  if (!best) return undefined;
  return {
    severity: best.severity,
    line: best.line,
    detail: matchDetail(`${best.label.trim()} → ${best.href}`, false, found.length),
  };
};
