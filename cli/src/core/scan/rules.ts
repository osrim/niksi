import { isAbsolute, normalize, join, dirname, basename, extname } from "node:path";
import { LinkifyIt } from "linkify-it";
import { decodeText, isSymlink, MODE_EXEC, type SkillFile } from "../skill/files.ts";
import { asText, parseFrontmatter } from "../skill/frontmatter.ts";
import { isValidSkillName, slugifySkillName } from "../skill/name.ts";
import { codeFences, fencedLines, lineAt } from "../skill/text.ts";
import type { Finding, Scanner, Severity } from "./index.ts";

export const RULES = {
  "curl-pipe-shell": { help: "pipes a download into a shell" },
  "base64-exec": { help: "decodes and runs base64" },
  "exfil-domain": { help: "known exfiltration endpoint" },
  "claude-settings": { help: "names agent settings or permissions" },
  "skip-permissions": { help: "disables permission prompts" },
  "credential-paths": { help: "reads credentials (~/.ssh, ~/.aws)" },
  "env-secrets": { help: "reads env vars or .env" },
  "prompt-injection": { help: "asks the agent to hide actions" },
  destructive: { help: "recursive delete" },
  "invisible-unicode": { help: "invisible characters" },
  "allowed-tools": { help: "pre-approves tools for itself" },
  "disallowed-tools": { help: "takes a tool away from the agent" },
  hooks: { help: "runs a configured command" },
  "load-time-exec": { help: "runs before the skill loads" },
  "context-fork": { help: "runs itself in a subagent" },
  "user-invocable": { help: "hidden from you, still callable by the agent" },
  "skill-config": { help: "sets how the agent runs it" },
  "skill-name": { help: "declared name is not a valid skill name" },
  "unknown-field": { help: "a frontmatter field niksi has no rule for" },
  frontmatter: { help: "frontmatter could not be read" },
  "frontmatter-inventory": { help: "frontmatter in a file no agent loads" },
  "agent-config": { help: "bundles agent config" },
  symlink: { help: "ships a symlink" },
  executable: { help: "ships an executable" },
  archive: { help: "ships an archive" },
  binary: { help: "ships a binary" },
  "external-url": { help: "links to an external host" },
} as const;

export type Rule = keyof typeof RULES;

const finding = (
  rule: Rule,
  fields: Omit<Finding, "rule" | "help">,
  help: string = RULES[rule].help,
): Finding => ({ rule, help, ...fields });

const ARCHIVE_EXTS = new Set([".zip", ".tar", ".gz", ".tgz", ".bz2", ".xz", ".7z", ".rar"]);

const AGENT_CONFIG_FILES = new Set([
  "plugin.json",
  ".mcp.json",
  "settings.json",
  "hooks.json",
  "opencode.json",
  "opencode.jsonc",
]);

// "?" matches any byte: a WebP stores its size at bytes 4 to 7.
const MEDIA_MAGIC: Record<string, string[]> = {
  ".png": ["\x89PNG\r\n\x1a\n"],
  ".jpg": ["\xff\xd8\xff"],
  ".jpeg": ["\xff\xd8\xff"],
  ".gif": ["GIF87a", "GIF89a"],
  ".webp": ["RIFF????WEBP"],
  ".pdf": ["%PDF-"],
  ".woff": ["wOFF"],
  ".woff2": ["wOF2"],
  ".ico": ["\0\0\x01\0"],
};

const isMedia = (file: SkillFile): boolean => {
  const head = file.content.subarray(0, 12).toString("latin1");
  return (MEDIA_MAGIC[extname(file.path).toLowerCase()] ?? []).some((magic) =>
    [...magic].every((byte, i) => byte === "?" || head[i] === byte),
  );
};

const binaryFinding = (file: SkillFile): Finding =>
  isMedia(file)
    ? finding("binary", {
        severity: "info",
        file: file.path,
        detail: `media file (${extname(file.path).toLowerCase()})`,
      })
    : finding("binary", { severity: "warn", file: file.path, detail: "binary file" });

const isScript = (file: SkillFile): boolean =>
  file.content.subarray(0, 2).toString("latin1") === "#!";

const fileFlags: Scanner = ({ files }) => {
  const findings: Finding[] = [];
  for (const file of files) {
    if (isSymlink(file.mode)) {
      const target = file.content.toString("utf8").trim();
      const escapes =
        isAbsolute(target) || normalize(join(dirname(file.path), target)).startsWith("..");
      findings.push(
        finding("symlink", {
          severity: escapes ? "critical" : "warn",
          file: file.path,
          detail: escapes
            ? `symlink escapes the skill directory (→ ${target})`
            : `symlink → ${target}`,
        }),
      );
      continue;
    }
    if (file.mode === MODE_EXEC) {
      // The scan reads a script's text, so only an opaque executable needs a look.
      const script = isScript(file);
      findings.push(
        finding("executable", {
          severity: script ? "info" : "warn",
          file: file.path,
          detail: script ? "executable script" : "executable file",
        }),
      );
    }
    if (ARCHIVE_EXTS.has(extname(file.path).toLowerCase())) {
      findings.push(
        finding("archive", { severity: "warn", file: file.path, detail: "archive file" }),
      );
    } else {
      const decoded = decodeText(file);
      if (!decoded) {
        findings.push(binaryFinding(file));
      } else if (decoded.nuls > 0) {
        findings.push(
          finding("binary", {
            severity: "critical",
            file: file.path,
            detail: `text file with ${decoded.nuls} NUL byte(s)`,
          }),
        );
      }
    }
    if (AGENT_CONFIG_FILES.has(basename(file.path))) {
      findings.push(
        finding("agent-config", {
          severity: "critical",
          file: file.path,
          detail: "bundles agent configuration (plugin/MCP/settings/hooks)",
        }),
      );
    }
  }
  return findings;
};

const INVISIBLE_RANGES = [
  { lo: 0xe0000, hi: 0xe007f, name: "Unicode tag" },
  { lo: 0x200b, hi: 0x200d, name: "zero-width" },
  { lo: 0xfeff, hi: 0xfeff, name: "zero-width no-break space" },
  { lo: 0x202a, hi: 0x202e, name: "bidi override" },
  { lo: 0x2066, hi: 0x2069, name: "bidi isolate" },
];

const invisibleUnicode: Scanner = ({ files }) => {
  const findings: Finding[] = [];
  for (const file of files) {
    const text = decodeText(file)?.text;
    if (text === undefined) continue;
    const hits: string[] = [];
    let index = 0;
    for (const ch of text) {
      const codepoint = ch.codePointAt(0)!;
      // A leading U+FEFF is a byte-order mark.
      if (!(codepoint === 0xfeff && index === 0)) {
        const range = INVISIBLE_RANGES.find(
          (candidate) => codepoint >= candidate.lo && codepoint <= candidate.hi,
        );
        if (range) hits.push(`U+${codepoint.toString(16).toUpperCase()} (${range.name})`);
      }
      index++;
    }
    if (hits.length > 0) {
      const sample = [...new Set(hits)].slice(0, 5).join(", ");
      findings.push(
        finding("invisible-unicode", {
          severity: "critical",
          file: file.path,
          detail: `${hits.length} invisible character(s): ${sample}`,
        }),
      );
    }
  }
  return findings;
};

const BENIGN_FIELDS = new Set([
  "name",
  "description",
  "when_to_use",
  "argument-hint",
  "arguments",
  "license",
  "compatibility",
  "metadata",
  "disable-model-invocation",
]);

const CONFIG_FIELDS = ["model", "effort", "paths", "shell"];

const fieldText = (key: string, value: unknown): string => {
  const text = asText(value).trim();
  return text ? `${key}: ${text}` : key;
};

const isMap = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : [value]);

const isFalse = (value: unknown): boolean => asText(value).trim() === "false";
const isTrue = (value: unknown): boolean => asText(value).trim() === "true";

const toolList = (value: unknown): string[] => {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.map((item) => asText(item).trim()).filter(Boolean);
  if (typeof value !== "string") return [asText(value)];
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of value) {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (depth === 0 && (ch === "," || /\s/u.test(ch))) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  return [...parts, current].map((part) => part.trim()).filter(Boolean);
};

const isUnscopedBash = (grant: string): boolean => /^Bash$|^Bash\(\s*\*/u.test(grant);

const HANDLER_PAYLOAD: Record<string, string[]> = {
  command: ["command"],
  http: ["url"],
  mcp_tool: ["server", "tool"],
  prompt: ["prompt"],
  agent: ["prompt"],
};

const handlerSummary = (handler: unknown): string => {
  if (!isMap(handler)) return asText(handler);
  const type = asText(handler["type"]).trim();
  const keys = HANDLER_PAYLOAD[type] ?? [...new Set(Object.values(HANDLER_PAYLOAD).flat())];
  const payload = keys
    .filter((key) => handler[key] !== undefined)
    .map((key) => asText(handler[key]).trim())
    .join(" ");
  const what = payload || asText(handler);
  return type && type !== "command" ? `${type} ${what}` : what;
};

const hookFindings = (hooks: unknown, file: string): Finding[] => {
  const found = (detail: string): Finding =>
    finding("hooks", { severity: "critical", file, detail });
  if (!isMap(hooks)) return [found(`hooks: ${asText(hooks)}`)];
  const findings: Finding[] = [];
  for (const [event, entries] of Object.entries(hooks)) {
    for (const entry of asList(entries)) {
      const matcher = isMap(entry) ? asText(entry["matcher"]).trim() : "";
      const where = matcher ? `${event}[${matcher}]` : event;
      const handlers =
        isMap(entry) && entry["hooks"] !== undefined ? asList(entry["hooks"]) : [entry];
      if (handlers.length === 0) {
        findings.push(found(`${where} → ${asText(entry)}`));
        continue;
      }
      for (const handler of handlers) findings.push(found(`${where} → ${handlerSummary(handler)}`));
    }
  }
  return findings.length > 0 ? findings : [found(`hooks: ${asText(hooks)}`)];
};

const skillPrivileges = (frontmatter: Record<string, unknown>, file: string): Finding[] => {
  const findings: Finding[] = [];
  const claimed = new Set([
    ...BENIGN_FIELDS,
    "hooks",
    "allowed-tools",
    "disallowed-tools",
    "user-invocable",
  ]);

  const declaredName = frontmatter["name"];
  if (
    typeof declaredName === "string" &&
    slugifySkillName(declaredName) &&
    !isValidSkillName(declaredName)
  ) {
    findings.push(
      finding("skill-name", {
        severity: "info",
        file,
        detail: fieldText("name", declaredName),
      }),
    );
  }

  if (frontmatter["hooks"] !== undefined && frontmatter["hooks"] !== null) {
    findings.push(...hookFindings(frontmatter["hooks"], file));
  }
  for (const grant of toolList(frontmatter["allowed-tools"])) {
    findings.push(
      finding("allowed-tools", {
        severity: isUnscopedBash(grant) ? "critical" : "warn",
        file,
        detail: grant,
      }),
    );
  }
  for (const tool of toolList(frontmatter["disallowed-tools"])) {
    findings.push(finding("disallowed-tools", { severity: "warn", file, detail: tool }));
  }

  if (asText(frontmatter["context"]).trim() === "fork") {
    claimed.add("context").add("agent").add("background");
    const extras = ["agent", "background"]
      .filter((key) => frontmatter[key] !== undefined)
      .map((key) => fieldText(key, frontmatter[key]));
    findings.push(
      finding("context-fork", {
        severity: "warn",
        file,
        detail: `context: fork${extras.length > 0 ? ` (${extras.join(", ")})` : ""}`,
      }),
    );
  }

  if (isFalse(frontmatter["user-invocable"]) && !isTrue(frontmatter["disable-model-invocation"])) {
    findings.push(
      finding("user-invocable", {
        severity: "warn",
        file,
        detail: "user-invocable: false, model invocation not disabled",
      }),
    );
  }

  for (const key of CONFIG_FIELDS) {
    claimed.add(key);
    if (frontmatter[key] === undefined) continue;
    findings.push(
      finding("skill-config", {
        severity: "info",
        file,
        detail: fieldText(key, frontmatter[key]),
      }),
    );
  }

  for (const [key, value] of Object.entries(frontmatter)) {
    if (claimed.has(key)) continue;
    findings.push(
      finding("unknown-field", { severity: "info", file, detail: fieldText(key, value) }),
    );
  }
  return findings;
};

const frontmatterInventory = (frontmatter: Record<string, unknown>, file: string): Finding[] =>
  Object.entries(frontmatter)
    .filter(([key]) => !BENIGN_FIELDS.has(key))
    .map(([key, value]) =>
      finding("frontmatter-inventory", {
        severity: "info",
        file,
        detail: fieldText(key, value),
      }),
    );

const isMarkdown = (path: string): boolean => extname(path).toLowerCase() === ".md";

const isEntry = (path: string): boolean => path === "SKILL.md";

const frontmatterPrivileges: Scanner = ({ files }) => {
  const findings: Finding[] = [];
  for (const file of files) {
    const text = isMarkdown(file.path) ? decodeText(file)?.text : undefined;
    if (text === undefined) continue;
    const entry = isEntry(file.path);
    let frontmatter: Record<string, unknown>;
    try {
      frontmatter = parseFrontmatter(text);
    } catch (e) {
      // Only SKILL.md grants permissions when an agent loads the skill.
      findings.push(
        finding(entry ? "frontmatter" : "frontmatter-inventory", {
          severity: entry ? "critical" : "info",
          file: file.path,
          detail: entry
            ? `invalid YAML. Permissions could not be checked. ${(e as Error).message}`
            : `invalid YAML. ${(e as Error).message}`,
        }),
      );
      continue;
    }
    findings.push(
      ...(entry
        ? skillPrivileges(frontmatter, file.path)
        : frontmatterInventory(frontmatter, file.path)),
    );
  }
  return findings;
};

// Claude executes these forms before it sends the skill to the model.
const INLINE_EXEC = /(?:^|\s)!`([^`\n]+)`/gu;
const loadTimeExecution: Scanner = ({ files }) => {
  const findings: Finding[] = [];
  for (const file of files) {
    const text = isMarkdown(file.path) ? decodeText(file)?.text : undefined;
    if (text === undefined) continue;
    const severity: Severity = isEntry(file.path) ? "critical" : "info";
    const report = (line: number, detail: string): void => {
      findings.push(finding("load-time-exec", { severity, file: file.path, line, detail }));
    };
    const inFence = new Set<number>();
    for (const fence of codeFences(text).filter((candidate) =>
      candidate.infoString.startsWith("!"),
    )) {
      for (let line = fence.startLine; line < fence.endLineExclusive; line += 1) inFence.add(line);
      for (const [lineOffset, line] of fence.content.split("\n").entries()) {
        const command = line.trim();
        if (command && !command.startsWith("#")) {
          report(fence.startLine + lineOffset + 2, command);
        }
      }
    }
    for (const [i, line] of text.split("\n").entries()) {
      if (inFence.has(i)) continue;
      for (const match of line.matchAll(INLINE_EXEC)) report(i + 1, match[1]!.trim());
    }
  }
  return findings;
};

// Undefined drops the match: it is not what the rule looks for.
type Judge = (match: RegExpExecArray, file: SkillFile, text: string) => Severity | undefined;

interface PatternRule {
  rule: Rule;
  severity: Severity | Judge;
  pattern: RegExp;
}

const lineBefore = (text: string, index: number): string =>
  text.slice(text.lastIndexOf("\n", index - 1) + 1, index);

const lineAround = (text: string, index: number): string => {
  const end = text.indexOf("\n", index);
  return lineBefore(text, index) + text.slice(index, end === -1 ? text.length : end);
};

const CREDENTIAL_NAME = String.raw`\w*(?:key|token|secret|pass|auth|cred)\w*`;
const CREDENTIAL_READ = String.raw`process\.env(?:\.|\[\s*["'\x60])${CREDENTIAL_NAME}|os\.(?:environ\.get\(|environ\[|getenv\()\s*["']${CREDENTIAL_NAME}`;
const ENV_DUMP = String.raw`JSON\.stringify\(\s*process\.env\s*\)|dict\(\s*os\.environ\s*\)|os\.environ\.(?:copy|items)\(\s*\)`;
const DOTENV_PATH = String.raw`(?<=["'/])\.env\b(?!\.(?:example|sample|template|dist)\b)`;

const EXEC_SINK = String.raw`(?<![.\w])(?:eval|exec)\s*\(`;
const NETWORK_OR_EXEC = new RegExp(
  String.raw`\bfetch\(|\brequests\.|\baxios[.(]|\bhttps?\.request\(|\bcurl\b|\bwget\b|${EXEC_SINK}|\bchild_process\b|\bsubprocess\.|\bos\.system\(`,
  "u",
);

const envSeverity: Judge = (_match, _file, text) => (NETWORK_OR_EXEC.test(text) ? "warn" : "info");

const BASE64_DECODER = String.raw`b64decode|base64_decode|base64\.decode(?:bytes|string)|atob\s*\(|Buffer\.from\([^\n]*?["']base64["']|base64[ \t]+(?:-d|-D|--decode)\b`;
const BASE64_SINK = String.raw`${EXEC_SINK}|(?<![.\w])eval[ \t]+["'$\x60]|\|[ \t]*(?:ba|z|da)?sh\b`;

const EXFIL_HOST = String.raw`(?<![\w.-])(?:[\w-]+\.)*(?:(?:webhook\.site|requestbin\.com|pipedream\.net|ngrok(?:-free)?\.(?:io|app|dev))(?![\w-]|\.[\w-])|discord(?:app)?\.com\/api\/webhooks\/|api\.telegram\.org\/bot|hooks\.slack\.com\/services\/)`;

const SENDS_LOCAL_DATA = [
  new RegExp(String.raw`${CREDENTIAL_READ}|\$\{?${CREDENTIAL_NAME}`, "iu"),
  new RegExp(
    String.raw`${ENV_DUMP}|(?<![\w-])(?:env|printenv)[ \t]*\||\$\([ \t]*(?:env|printenv)[ \t]*\)`,
    "u",
  ),
  /\$\([ \t]*cat[ \t]|(?<!\S)(?:-F|-T|--upload-file)(?!\S)|(?:=|(?<!\S)(?:-d|--data(?:-\w+)?)[ \t]+["']?)@[\w~./-]/u,
];

const exfilSeverity: Judge = (match, _file, text) =>
  SENDS_LOCAL_DATA.some((pattern) => pattern.test(lineAround(text, match.index)))
    ? "critical"
    : "warn";

const SETTINGS_REDIRECT = /(?:\S[ \t]+>>?|\btee(?:[ \t]+-[\w-]+)*)[ \t]*["']?[^\s"'<>|;&]*$/u;
const OPENS_WITH_WRITE = /^\P{L}*(?:add|write|edit|modify|append|set|update|change)\b/iu;

const settingsSeverity: Judge = (match, file, text) => {
  if (match[0] === "permissions.allow") return "critical";
  const before = lineBefore(text, match.index);
  if (SETTINGS_REDIRECT.test(before)) return "critical";
  const sentence = before.split(/[.!?]\s+/u).at(-1)!;
  return isEntry(file.path) && OPENS_WITH_WRITE.test(sentence) ? "critical" : "warn";
};

// The idea of SC2114 and SC2115. No ShellCheck code is copied: ShellCheck is GPL-3.0.
const IMPORTANT_PATHS = new Set(
  "/ ~ $HOME ${HOME} /bin /boot /dev /etc /home /lib /lib64 /media /mnt /usr /usr/bin /usr/local /var /Users /System /Library".split(
    " ",
  ),
);
const UNGUARDED_VAR_DIR = /^\$\{?\w+\}?\/\*?$/u;

const isImportantTarget = (token: string): boolean => {
  const target = token.replaceAll(/["']/gu, "").replace(/(?<=.)[.,:]+$/u, "");
  return (
    UNGUARDED_VAR_DIR.test(target) || IMPORTANT_PATHS.has(target.replace(/\/\*?$/u, "") || "/")
  );
};

const deleteSeverity: Judge = ({ groups }) => {
  const { sudo, flags = "", targets = "" } = groups ?? {};
  if (!/(?:^|\s)(?:-[a-zA-Z]*[rR]|--recursive\b)/u.test(flags)) return undefined;
  const important = targets.split(/\s+/u).filter(Boolean).some(isImportantTarget);
  return sudo || important ? "critical" : "info";
};

const PATTERN_RULES: PatternRule[] = [
  {
    rule: "curl-pipe-shell",
    severity: "critical",
    pattern: /\b(curl|wget)\b[^\n|]*\|\s*(ba|z|da)?sh\b/gu,
  },
  {
    rule: "base64-exec",
    severity: "critical",
    pattern: new RegExp(
      `(?:${BASE64_DECODER})[^\\n]*?(?:${BASE64_SINK})|(?:${BASE64_SINK})[^\\n]*?(?:${BASE64_DECODER})`,
      "gu",
    ),
  },
  { rule: "exfil-domain", severity: exfilSeverity, pattern: new RegExp(EXFIL_HOST, "giu") },
  {
    rule: "claude-settings",
    severity: settingsSeverity,
    pattern: /\.claude\/settings(\.local)?\.json|permissions\.allow/gu,
  },
  { rule: "skip-permissions", severity: "critical", pattern: /--dangerously-skip-permissions/gu },
  {
    rule: "credential-paths",
    severity: "critical",
    pattern: /~\/\.ssh\b|\bid_rsa\b|~\/\.aws\b/gu,
  },
  {
    rule: "env-secrets",
    severity: envSeverity,
    pattern: new RegExp(`${CREDENTIAL_READ}|${ENV_DUMP}|${DOTENV_PATH}`, "giu"),
  },
  {
    rule: "prompt-injection",
    severity: "warn",
    pattern:
      /ignore (all )?(previous|prior|above) instructions|do not (tell|inform) the user|without (telling|asking) the user/giu,
  },
  {
    rule: "destructive",
    severity: deleteSeverity,
    pattern:
      /\b(?<sudo>sudo(?:[ \t]+-\S*(?:[ \t]+[^\s-]\S*)??)*[ \t]+)?rm(?<flags>(?:[ \t]+--?[\w-]+)+)(?<targets>(?:[ \t]+[^\s;&|)`]+)*)/gu,
  },
];

const STRENGTH: Severity[] = ["info", "warn", "critical"];

const stronger = (a: Severity, b: Severity): boolean => STRENGTH.indexOf(a) > STRENGTH.indexOf(b);

const PROHIBITION =
  /\b(never|do not|don't|must not|should not|avoid|refuses? (requests? )?to)\s+((ever\s+)?(run|execute|use|call|invoke|type|paste|pipe|ignore|pass)(ing)?\s+(\w+\s+with\s+)?)?[`'"]?$/iu;

// Only Markdown prose explains a command; code and scripts run it.
const prohibitionTest = (file: SkillFile, text: string): ((index: number) => boolean) => {
  if (!isMarkdown(file.path)) return () => false;
  const fenced = fencedLines(text);
  return (index) =>
    !fenced.has(lineAt(text, index) - 1) && PROHIBITION.test(lineBefore(text, index));
};

const patternFinding = (
  { rule, severity, pattern }: PatternRule,
  file: SkillFile,
  text: string,
  afterProhibition: (index: number) => boolean,
): Finding | undefined => {
  const judge = typeof severity === "function" ? severity : () => severity;
  let count = 0;
  let best: { match: RegExpExecArray; severity: Severity; quiet: boolean } | undefined;
  for (const match of text.matchAll(pattern)) {
    const judged = judge(match, file, text);
    if (!judged) continue;
    count++;
    const quiet = afterProhibition(match.index);
    const current = quiet ? "info" : judged;
    if (!best || stronger(current, best.severity)) best = { match, severity: current, quiet };
  }
  if (!best) return undefined;
  const detail = [
    best.match[0].trim(),
    ...(best.quiet ? ["(in a warning)"] : []),
    ...(count > 1 ? [`(${count} matches)`] : []),
  ].join(" ");
  return finding(rule, {
    severity: best.severity,
    file: file.path,
    line: lineAt(text, best.match.index),
    detail,
  });
};

const suspiciousPatterns: Scanner = ({ files }) =>
  files.flatMap((file) => {
    const text = decodeText(file)?.text;
    if (text === undefined) return [];
    const afterProhibition = prohibitionTest(file, text);
    return PATTERN_RULES.flatMap(
      (rule) => patternFinding(rule, file, text, afterProhibition) ?? [],
    );
  });

// Fuzzy matching also finds schemeless hosts, such as `evil.sh` after curl.
const linkify = new LinkifyIt({ fuzzyLink: true, fuzzyEmail: false, urlAuth: true });

const LOCK_FILES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "Cargo.lock",
  "poetry.lock",
  "uv.lock",
]);

const isLocalOrReserved = (hostname: string): boolean =>
  hostname === "localhost" ||
  hostname === "[::1]" ||
  /^(127|10)\.\d+\.\d+\.\d+$/u.test(hostname) ||
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/u.test(hostname) ||
  /^192\.168\.\d+\.\d+$/u.test(hostname) ||
  /(^|\.)example\.[^.]+$/u.test(hostname) ||
  /\.(invalid|test)$/u.test(hostname);

const FETCH = /\b(curl|wget|fetch)\b/u;

interface Link {
  host: string;
  file: string;
  line: number;
  url: string;
}

const fileLinks = (file: SkillFile, text: string, bundled: Set<string>): Link[] => {
  const namesBundledFile = (name: string): boolean => {
    const path = name.split(/[?#]/u)[0]!.toLowerCase();
    return (
      bundled.has(normalize(join(dirname(file.path.toLowerCase()), path))) ||
      bundled.has(normalize(path))
    );
  };
  return (linkify.match(text) ?? []).flatMap((link) => {
    let url: URL;
    try {
      url = new URL(link.url);
    } catch {
      return [];
    }
    if (isLocalOrReserved(url.hostname)) return [];
    const schemeless = link.schema === "";
    if (schemeless && namesBundledFile(link.text) && !FETCH.test(lineBefore(text, link.index))) {
      return [];
    }
    return [{ host: url.host, file: file.path, line: lineAt(text, link.index), url: link.text }];
  });
};

const urlInventory: Scanner = ({ files }) => {
  const bundled = new Set(files.map((file) => file.path.toLowerCase()));
  const links = new Map<string, Link>();
  for (const file of files) {
    if (isSymlink(file.mode) || LOCK_FILES.has(basename(file.path))) continue;
    const text = decodeText(file)?.text;
    if (text === undefined) continue;
    for (const link of fileLinks(file, text, bundled)) {
      const key = `${link.file}\0${link.url}`;
      if (!links.has(key)) links.set(key, link);
    }
  }
  const byHost = Map.groupBy(links.values(), (link) => link.host);
  const hostCount = byHost.size;
  const help = `${hostCount} external host${hostCount === 1 ? "" : "s"}, ${links.size} link${links.size === 1 ? "" : "s"}`;
  return [...byHost.entries()]
    .toSorted((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .flatMap(([, hostLinks]) =>
      hostLinks
        .toSorted((a, b) => a.url.localeCompare(b.url) || a.file.localeCompare(b.file))
        .map(({ file, line, url }) =>
          finding("external-url", { severity: "info", file, line, detail: url }, help),
        ),
    );
};

export const defaultScanners: Scanner[] = [
  fileFlags,
  invisibleUnicode,
  frontmatterPrivileges,
  loadTimeExecution,
  suspiciousPatterns,
  urlInventory,
];
