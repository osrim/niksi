import { isAbsolute, normalize, join, dirname, extname } from "node:path";
import { LinkifyIt } from "linkify-it";
import { decodeText, isSymlink, MODE_EXEC, MODE_FILE, type SkillFile } from "../skill/files.ts";
import { asText, parseFrontmatter } from "../skill/frontmatter.ts";
import { isValidSkillName, slugifySkillName } from "../skill/name.ts";
import { mapMarkdown, type MarkdownMap } from "../skill/markdown.ts";
import { codeFences, lineAt } from "../skill/text.ts";
import { fileName, namedPaths, pathParts } from "./archive.ts";
import { combine } from "./combine.ts";
import { credentialPaths } from "./credential-paths.ts";
import { demotes } from "./context.ts";
import { embeddedSecrets } from "./embedded-secret.ts";
import { hiddenHtml } from "./hidden-html.ts";
import { invisibleCharacters } from "./invisible.ts";
import type { Finding, Scanner, Severity } from "./index.ts";
import { remoteInstructions } from "./remote-instructions.ts";
import { lower, stronger } from "./severity.ts";
import { urlCredentials } from "./url-credentials.ts";
import { mapHome, shellStatements, type Command, type Statement } from "./shell.ts";

export const RULES = {
  "curl-pipe-shell": { help: "runs downloaded code" },
  "base64-exec": { help: "decodes and runs base64" },
  "exfil-domain": { help: "known exfiltration endpoint" },
  "claude-settings": { help: "names agent settings or permissions" },
  "skip-permissions": { help: "disables permission prompts" },
  "credential-paths": { help: "names a credential file or store" },
  "env-secrets": { help: "reads env vars or .env" },
  "embedded-secret": { help: "ships a token or private key" },
  "url-credentials": { help: "a password in a URL or auth header" },
  "prompt-injection": { help: "asks the agent to hide actions" },
  destructive: { help: "recursive delete" },
  "invisible-unicode": { help: "invisible characters" },
  "hidden-html": { help: "text a reader does not see" },
  "remote-instructions": { help: "fetches instructions to follow" },
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
  "archive-contents": { help: "archive not fully scanned" },
  binary: { help: "ships a binary" },
  "external-url": { help: "links to an external host" },
} as const;

export type Rule = keyof typeof RULES;

export const finding = (
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
    if (AGENT_CONFIG_FILES.has(fileName(file))) {
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

// A media file's bytes decode to stray code points, and agents do not read it as text.
const invisibleUnicode: Scanner = ({ files }) =>
  files.flatMap((file) => {
    const text = isMedia(file) ? undefined : decodeText(file)?.text;
    if (text === undefined) return [];
    const injections = [...text.matchAll(PROMPT_INJECTION)].map((match) => ({
      line: lineAt(text, match.index),
    }));
    const found = invisibleCharacters(text, injections);
    return found ? [finding("invisible-unicode", { file: file.path, ...found })] : [];
  });

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

const isProse = (path: string): boolean =>
  isMarkdown(path) || extname(path).toLowerCase() === ".txt";

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

const PROMPT_INJECTION =
  /ignore (all )?(previous|prior|above) instructions|do not (tell|inform) the user|without (telling|asking) the user/giu;

const PATTERN_RULES: PatternRule[] = [
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
    rule: "env-secrets",
    severity: envSeverity,
    pattern: new RegExp(`${CREDENTIAL_READ}|${ENV_DUMP}|${DOTENV_PATH}`, "giu"),
  },
  {
    rule: "prompt-injection",
    severity: "warn",
    pattern: PROMPT_INJECTION,
  },
  {
    rule: "destructive",
    severity: deleteSeverity,
    pattern:
      /\b(?<sudo>sudo(?:[ \t]+-\S*(?:[ \t]+[^\s-]\S*)??)*[ \t]+)?rm(?<flags>(?:[ \t]+--?[\w-]+)+)(?<targets>(?:[ \t]+[^\s;&|)`]+)*)/gu,
  },
];

const lowerIf = (demoted: boolean, severity: Severity): Severity =>
  demoted ? lower(severity) : severity;

const PROHIBITION =
  /\b(never|do not|don't|must not|should not|avoid|refuses? (requests? )?to)\s+((ever\s+)?(run|execute|use|call|invoke|type|paste|pipe|ignore|pass)(ing)?\s+(\w+\s+with\s+)?)?[`'"]?$/iu;

interface ProseContext {
  map?: MarkdownMap;
  afterProhibition: (index: number) => boolean;
  demoted: (index: number) => boolean;
}

// Only Markdown prose explains or demotes a command; code and scripts run it.
const proseContext = (file: SkillFile, text: string): ProseContext => {
  if (!isMarkdown(file.path)) return { afterProhibition: () => false, demoted: () => false };
  const map = mapMarkdown(text);
  return {
    map,
    afterProhibition: (index) => !map.isCode(index) && PROHIBITION.test(lineBefore(text, index)),
    demoted: demotes(pathParts(file), map),
  };
};

const patternFinding = (
  { rule, severity, pattern }: PatternRule,
  file: SkillFile,
  text: string,
  { afterProhibition, demoted }: ProseContext,
): Finding | undefined => {
  const judge = typeof severity === "function" ? severity : () => severity;
  let count = 0;
  let best: { match: RegExpExecArray; severity: Severity; quiet: boolean } | undefined;
  for (const match of text.matchAll(pattern)) {
    const judged = judge(match, file, text);
    if (!judged) continue;
    count++;
    const quiet = afterProhibition(match.index);
    const current = quiet ? "info" : lowerIf(demoted(match.index), judged);
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
    const context = proseContext(file, text);
    return PATTERN_RULES.flatMap((rule) => patternFinding(rule, file, text, context) ?? []);
  });

const DOWNLOADERS = String.raw`curl|wget|fetch|iwr|irm|invoke-webrequest|invoke-restmethod`;
const SHELLS = String.raw`(?:ba|z|da|k|a|fi)?sh`;
const EVALUATORS = String.raw`iex|invoke-expression`;
const INTERPRETERS = String.raw`${SHELLS}|python[\d.]*|node|bun|deno|perl|ruby|php|osascript|pwsh|powershell|${EVALUATORS}`;
const DOWNLOADS = new RegExp(String.raw`(?<![\w-])(?:${DOWNLOADERS})(?![\w-])`, "iu");
const DOWNLOADER = new RegExp(`^(?:${DOWNLOADERS})$`, "iu");
const SHELL = new RegExp(`^${SHELLS}$`, "u");
const INTERPRETER = new RegExp(`^(?:${INTERPRETERS})$`, "iu");
const EVALUATOR = new RegExp(`^(?:${EVALUATORS})$`, "iu");
const RUNS_ARGUMENT = /^(?:eval|source|\.|exec)$/u;
const RUN_SUBCOMMAND = /^(?:bun|deno)$/iu;
const SHELL_CODE_FLAG = /^-[a-zA-Z]*c[a-zA-Z]*$/u;
const SHELL_STDIN_FLAG = /^-[a-zA-Z]*s[a-zA-Z]*$/u;
const CODE_FLAG = /^-(?:c|e|m|r|p|-eval|-print|command)$/iu;
const EVAL_OF_DOWNLOAD = new RegExp(
  String.raw`(?:${EXEC_SINK}|\bnew\s+Function\s*\()[^\n]*?(?:\burlopen|\brequests\.get|(?<![.\w])fetch)\s*\(|\b(?:${EVALUATORS})\b[^\n]*?\.downloadstring\s*\(|\.downloadstring\s*\([^\n]*?\|\s*(?:${EVALUATORS})\b`,
  "iu",
);
const URLRETRIEVE = /\burlretrieve\s*\(/u;
const RUNS_PYTHON = new RegExp(String.raw`\bsubprocess\.|${EXEC_SINK}`, "u");

const bare = (word: string): string =>
  word
    .replace(/^[(!"'`]+/u, "")
    .replace(/[,:;!?)"'`]+$/u, "")
    .replace(/(?<=.)\.$/u, "");

const commandName = (word: string): string => bare(word).replace(/^.*\//u, "") || bare(word);

const isCodeFlag = (name: string, word: string): boolean =>
  (SHELL.test(name) ? SHELL_CODE_FLAG : CODE_FLAG).test(word);

const isCommandWord = (word: string): boolean => {
  const name = commandName(word);
  return (
    DOWNLOADER.test(name) ||
    INTERPRETER.test(name) ||
    RUNS_ARGUMENT.test(name) ||
    name === "chmod" ||
    /^["'`]?(?:\.\/|\$\()/u.test(word)
  );
};

// Prose and comments name the command after other words, as in "To install, run bash <(curl …)".
const commandWords = (statement: Statement, command: Command): string[] => {
  if (statement.kind === "code") return command.words;
  const start = command.words.findIndex(isCommandWord);
  return start === -1 ? [] : command.words.slice(start);
};

const commandText = (statement: Statement): string => {
  if (statement.kind === "code") return statement.text;
  const start = [...statement.text.matchAll(/\S+/gu)].find(([token]) =>
    isCommandWord(mapHome(token)),
  )?.index;
  return statement.text.slice(start ?? 0);
};

const isDownload = (words: string[]): boolean => DOWNLOADER.test(commandName(words[0] ?? ""));

// `bun run x.ts` and `deno run -A x.ts` name the script after the `run` subcommand.
const scriptOperand = (name: string, args: string[]): string | undefined =>
  (RUN_SUBCOMMAND.test(name) && args[0] === "run" ? args.slice(1) : args).find(
    (arg) => !arg.startsWith("-"),
  );

// Prose words after an interpreter are not arguments unless they look like a path.
const runsStdin = (words: string[], prose: boolean): boolean => {
  const [command = "", ...args] = words;
  const name = commandName(command);
  if (!INTERPRETER.test(name)) return false;
  if (EVALUATOR.test(name)) return true;
  if (SHELL.test(name)) {
    if (args.some((arg) => SHELL_STDIN_FLAG.test(arg))) return true;
    // xargs supplies the command string after a trailing -c.
    if (SHELL_CODE_FLAG.test(args.at(-1) ?? "")) return true;
  }
  if (args.some((arg) => isCodeFlag(name, arg))) return false;
  const script = scriptOperand(name, args);
  return script === undefined || (prose && !/[./]/u.test(script));
};

const runsSubstitution = (words: string[], command: Command): boolean => {
  const downloads = command.substitutions.filter((sub) => DOWNLOADS.test(sub.body));
  if (downloads.length === 0) return false;
  const [first = "", ...args] = words;
  if (/^["'`]?(?:\$\(|`)/u.test(first)) return true;
  const name = commandName(first);
  if (RUNS_ARGUMENT.test(name)) return true;
  if (!INTERPRETER.test(name)) return false;
  return downloads.some((sub) => sub.kind === "<(" || args.some((arg) => isCodeFlag(name, arg)));
};

const feedsInterpreter = (statement: Statement): boolean => {
  if (EVAL_OF_DOWNLOAD.test(statement.text)) return true;
  const { commands } = statement;
  const prose = statement.kind === "prose";
  const download = commands.findIndex((command) => isDownload(commandWords(statement, command)));
  if (download !== -1 && commands.slice(download + 1).some((c) => runsStdin(c.words, prose))) {
    return true;
  }
  return commands.some((command) => runsSubstitution(commandWords(statement, command), command));
};

const asPath = (word: string): string | undefined => {
  if (/^[a-z]+:\/\//iu.test(word)) {
    try {
      return new URL(word).pathname.split("/").at(-1) || undefined;
    } catch {
      return undefined;
    }
  }
  const path = bare(word).replaceAll("\\", "/").replace(/^\.\//u, "");
  return path && path !== "-" && !path.startsWith("&") && path !== "/dev/null" ? path : undefined;
};

const OUTPUT_LONG = /^(?:--output(?:-document)?|-outfile)(?:=(.*))?$/iu;
const OUTPUT_SHORT = /^-[a-zA-Z]*?[oO](.*)$/u;
const REDIRECT = /^1?>>?(.*)$/u;

const downloadTargets = (words: string[]): string[] => {
  if (!isDownload(words)) return [];
  const targets: string[] = [];
  for (let i = 1; i < words.length; i++) {
    const word = words[i]!;
    const flag = OUTPUT_LONG.exec(word) ?? (word.startsWith("--") ? null : OUTPUT_SHORT.exec(word));
    const option = flag ?? REDIRECT.exec(word);
    if (!option) continue;
    const attached = option[1];
    const value = attached || words[++i];
    const path = value === undefined ? undefined : asPath(value);
    if (path) targets.push(path);
  }
  return targets;
};

const EXEC_MODE = /\+[rwxXst]*x|^[0-7]{0,1}[0-7]*[1357][0-7]{0,2}$/u;

const runTargets = (words: string[]): string[] => {
  const [command = "", ...args] = words;
  const name = commandName(command);
  if (name === "chmod") {
    const [mode = "", ...files] = args.filter((arg) => !/^-[RfvcH]+$/u.test(arg));
    return EXEC_MODE.test(mode) ? files : [];
  }
  if (INTERPRETER.test(name) || RUNS_ARGUMENT.test(name)) {
    if (args.some((arg) => isCodeFlag(name, arg))) return [];
    const script = scriptOperand(name, args);
    return script === undefined ? [] : [script];
  }
  return command.includes("/") ? [command] : [];
};

interface Step {
  statement: Statement;
  line: number;
  path: string;
}

const steps = (statements: Statement[], targets: (words: string[]) => string[]): Step[] =>
  statements.flatMap((statement) =>
    statement.commands.flatMap((command) =>
      targets(commandWords(statement, command)).flatMap((target) => {
        const path = asPath(target);
        return path ? [{ statement, line: statement.line, path }] : [];
      }),
    ),
  );

interface Hit {
  statements: Statement[];
  detail: string;
}

const savedAndRun = (statements: Statement[]): Hit[] => {
  const files = combine(steps(statements, downloadTargets), steps(statements, runTargets), {
    related: (download, run) => download.path === run.path,
  }).map(({ anchor, partner }) => [anchor.statement, partner.statement] as const);
  const code = statements.filter((s) => s.kind !== "prose");
  const python = combine(
    code.filter((s) => URLRETRIEVE.test(s.text)),
    code.filter((s) => RUNS_PYTHON.test(s.text) && !URLRETRIEVE.test(s.text)),
  ).map(({ anchor, partner }) => [anchor, partner] as const);
  return [...files, ...python].map(([download, run]) => ({
    statements: [download, run],
    detail: `${commandText(download)} → ${commandText(run)} (line ${run.line})`,
  }));
};

// A comment or reference prose drops one level. Prose is never a comment, so the drops never stack.
const statementSeverity = (statement: Statement, context: ProseContext): Severity => {
  if (statement.kind === "code") return "critical";
  if (statement.kind === "prose") {
    const start = statement.index + statement.text.length - commandText(statement).length;
    if (context.afterProhibition(start)) return "info";
    if (!context.demoted(start)) return "critical";
  }
  return lower("critical");
};

const weakest = (severities: Severity[]): Severity =>
  severities.reduce((a, b) => (stronger(a, b) ? b : a));

const downloadedCode: Scanner = ({ files }) =>
  files.flatMap((file) => {
    const text = decodeText(file)?.text;
    if (text === undefined || isSymlink(file.mode)) return [];
    const context = proseContext(file, text);
    const prose = isProse(file.path);
    const statements = shellStatements(text, prose);
    const hits: Hit[] = [
      ...statements
        .filter(feedsInterpreter)
        .map((statement) => ({ statements: [statement], detail: commandText(statement) })),
      ...savedAndRun(statements),
    ].toSorted((a, b) => a.statements[0]!.index - b.statements[0]!.index);
    let best: { hit: Hit; severity: Severity } | undefined;
    for (const hit of hits) {
      const severity = weakest(hit.statements.map((s) => statementSeverity(s, context)));
      if (!best || stronger(severity, best.severity)) best = { hit, severity };
    }
    if (!best) return [];
    const detail = [
      best.hit.detail,
      ...(best.severity === "info" ? ["(in a warning)"] : []),
      ...(hits.length > 1 ? [`(${hits.length} matches)`] : []),
    ].join(" ");
    return [
      finding("curl-pipe-shell", {
        severity: best.severity,
        file: file.path,
        line: best.hit.statements[0]!.line,
        detail,
      }),
    ];
  });

const remoteInstructionText: Scanner = ({ files }) =>
  files.flatMap((file) => {
    const text = isProse(file.path) ? decodeText(file)?.text : undefined;
    if (text === undefined || isSymlink(file.mode)) return [];
    const { map, demoted } = proseContext(file, text);
    const found = remoteInstructions(text, map, demoted);
    return found ? [finding("remote-instructions", { file: file.path, ...found })] : [];
  });

const credentialPathText: Scanner = ({ files }) =>
  files.flatMap((file) => {
    const text = decodeText(file)?.text;
    if (text === undefined || isSymlink(file.mode)) return [];
    const found = credentialPaths(
      shellStatements(text, isProse(file.path)),
      proseContext(file, text),
    );
    return found ? [finding("credential-paths", { file: file.path, ...found })] : [];
  });

const SENDS = new RegExp(String.raw`${DOWNLOADS.source}|\brequests\.|${EXFIL_HOST}`, "iu");

const embeddedSecretText: Scanner = ({ files }) =>
  files.flatMap((file) => {
    const text = decodeText(file)?.text;
    if (text === undefined || isSymlink(file.mode)) return [];
    const sendLines = text.split("\n").flatMap((line, i) => (SENDS.test(line) ? [i + 1] : []));
    const found = embeddedSecrets(text, sendLines);
    return found ? [finding("embedded-secret", { file: file.path, ...found })] : [];
  });

const urlCredentialText: Scanner = ({ files }) =>
  files.flatMap((file) => {
    const text = decodeText(file)?.text;
    if (text === undefined || isSymlink(file.mode)) return [];
    const found = urlCredentials(text);
    return found ? [finding("url-credentials", { file: file.path, ...found })] : [];
  });

const TEXT_SCANNERS = [
  downloadedCode,
  suspiciousPatterns,
  remoteInstructionText,
  credentialPathText,
  embeddedSecretText,
  urlCredentialText,
];

// Hidden text scans as a plain text file: no Markdown prose context can demote it.
const scanHiddenText = (body: string): Finding[] =>
  TEXT_SCANNERS.flatMap((scan) =>
    scan({
      name: "hidden",
      files: [{ path: "hidden.txt", content: Buffer.from(body), mode: MODE_FILE }],
    }),
  );

const hiddenText: Scanner = ({ files }) =>
  files.flatMap((file) => {
    const text = isMarkdown(file.path) ? decodeText(file)?.text : undefined;
    if (text === undefined || isSymlink(file.mode)) return [];
    const found = hiddenHtml(text, mapMarkdown(text).hidden, scanHiddenText);
    return found ? [finding("hidden-html", { file: file.path, ...found })] : [];
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
    return namedPaths(file, path).some((named) => bundled.has(named.toLowerCase()));
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
    if (isSymlink(file.mode) || LOCK_FILES.has(fileName(file))) continue;
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
  ...TEXT_SCANNERS,
  hiddenText,
  urlInventory,
];
