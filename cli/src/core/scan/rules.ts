import { isAbsolute, normalize, join, dirname, extname } from "node:path";
import { LinkifyIt } from "linkify-it";
import {
  decodeText,
  isSymlink,
  MODE_EXEC,
  MODE_FILE,
  startsWithShebang,
  type SkillFile,
} from "../skill/files.ts";
import { asText, parseFrontmatter } from "../skill/frontmatter.ts";
import { isValidSkillName, slugifySkillName } from "../skill/name.ts";
import { mapMarkdown, type MarkdownMap } from "../skill/markdown.ts";
import { codeFences, lineAt } from "../skill/text.ts";
import { fileName, namedPaths, pathParts } from "./archive.ts";
import { base64Exec, base64ExecMatches } from "./base64-exec.ts";
import { combine, nearest } from "./combine.ts";
import { credentialDisclosure } from "./credential-disclosure.ts";
import { credentialPaths } from "./credential-paths.ts";
import { demotes, type ProseJudge } from "./context.ts";
import { dependencySource } from "./dependency-source.ts";
import { destructive, destructiveMatches } from "./destructive.ts";
import { embeddedSecrets } from "./embedded-secret.ts";
import { invalidEncoding } from "./encoding.ts";
import { isMedia, misleadingExtension } from "./file-signature.ts";
import { hiddenHtml } from "./hidden-html.ts";
import { invisibleCharacters } from "./invisible.ts";
import type { Confidence, Finding, ScannedSkill, Scanner, Severity } from "./index.ts";
import { installHook } from "./install-hook.ts";
import { isMap } from "./manifest.ts";
import { moneyMovement, moneyPhrases } from "./money-movement.ts";
import { persistence, persistenceMatches } from "./persistence.ts";
import {
  bare,
  commandName,
  EVALUATORS,
  EXEC_SINK,
  INTERPRETER,
  isCodeFlag,
  RUNS_ARGUMENT,
  runsStdin,
  scriptOperand,
} from "./interpreter.ts";
import { injections, promptInjection } from "./prompt-injection.ts";
import { judgePhrases, proseSentences } from "./prose.ts";
import { remoteInstructions } from "./remote-instructions.ts";
import { reverseShell } from "./reverse-shell.ts";
import { silentExec } from "./silent-exec.ts";
import { suppressionComments } from "./suppression.ts";
import { gated, lower, lowerConfidence, stronger, strongest } from "./severity.ts";
import { urlCredentials } from "./url-credentials.ts";
import { mapHome, shellStatements, type Command, type Statement } from "./shell.ts";

export const RULES = {
  "curl-pipe-shell": { help: "runs downloaded code", confidence: "high" },
  "base64-exec": { help: "decodes and runs hidden code", confidence: "high" },
  "reverse-shell": { help: "opens a shell to a remote host", confidence: "high" },
  "exfil-domain": { help: "known exfiltration endpoint", confidence: "high" },
  "claude-settings": { help: "names agent settings or permissions", confidence: "high" },
  "skip-permissions": { help: "disables permission prompts", confidence: "high" },
  "credential-paths": { help: "names a credential file", confidence: "high" },
  "credential-disclosure": { help: "asks for a secret or sends one out", confidence: "medium" },
  "env-secrets": { help: "reads env vars or .env", confidence: "high" },
  "embedded-secret": { help: "ships a token or private key", confidence: "high" },
  "url-credentials": { help: "puts a password in a URL or header", confidence: "high" },
  "prompt-injection": { help: "asks the agent to hide actions", confidence: "medium" },
  destructive: { help: "destroys data or loosens permissions", confidence: "high" },
  persistence: { help: "installs something that runs again later", confidence: "high" },
  "silent-exec": { help: "starts a detached or silenced process", confidence: "high" },
  "dependency-source": {
    help: "installs from a source it picks, or skips TLS checks",
    confidence: "high",
  },
  "install-hook": { help: "runs a script when a package installs", confidence: "high" },
  "money-movement": { help: "moves money", confidence: "medium" },
  "suppression-comment": {
    help: "author-side suppression comment ignored",
    confidence: "high",
  },
  "invisible-unicode": { help: "invisible characters", confidence: "high" },
  "hidden-html": { help: "text a reader does not see", confidence: "high" },
  "remote-instructions": { help: "fetches instructions to follow", confidence: "medium" },
  "allowed-tools": { help: "pre-approves tools for itself", confidence: "high" },
  "disallowed-tools": { help: "takes a tool away from the agent", confidence: "high" },
  hooks: { help: "runs a configured command", confidence: "high" },
  "load-time-exec": { help: "runs before the skill loads", confidence: "high" },
  "context-fork": { help: "runs itself in a subagent", confidence: "high" },
  "user-invocable": { help: "hidden from you, still callable by the agent", confidence: "high" },
  "skill-config": { help: "sets how the agent runs it", confidence: "high" },
  "skill-name": { help: "declared name is not a valid skill name", confidence: "high" },
  "unknown-field": { help: "a frontmatter field niksi has no rule for", confidence: "high" },
  frontmatter: { help: "frontmatter could not be read", confidence: "high" },
  "frontmatter-inventory": { help: "frontmatter in a file no agent loads", confidence: "high" },
  "agent-config": { help: "bundles agent config", confidence: "high" },
  symlink: { help: "ships a symlink", confidence: "high" },
  executable: { help: "ships an executable", confidence: "high" },
  archive: { help: "ships an archive", confidence: "high" },
  "archive-contents": { help: "archive not fully scanned", confidence: "high" },
  binary: { help: "ships a binary", confidence: "high" },
  "invalid-encoding": { help: "text that is not UTF-8", confidence: "high" },
  "misleading-extension": { help: "content does not match its extension", confidence: "high" },
  "external-url": { help: "links to an external host", confidence: "high" },
} as const satisfies Record<string, { help: string; confidence: Confidence }>;

export type Rule = keyof typeof RULES;

type Fields = Omit<Finding, "rule" | "help" | "confidence"> & Partial<Pick<Finding, "confidence">>;

// Without a confidence the finding takes its rule's: high for syntax, medium for prose intent.
export const finding = (
  rule: Rule,
  { confidence = RULES[rule].confidence, ...fields }: Fields,
  help: string = RULES[rule].help,
): Finding => ({
  rule,
  help,
  ...fields,
  confidence,
  severity: gated(fields.severity, confidence),
});

const ARCHIVE_EXTS = new Set([".zip", ".tar", ".gz", ".tgz", ".bz2", ".xz", ".7z", ".rar"]);

const AGENT_CONFIG_FILES = new Set([
  "plugin.json",
  ".mcp.json",
  "settings.json",
  "hooks.json",
  "opencode.json",
  "opencode.jsonc",
]);

const binaryFinding = (file: SkillFile): Finding =>
  isMedia(file)
    ? finding("binary", {
        severity: "info",
        file: file.path,
        detail: `media file (${extname(file.path).toLowerCase()})`,
      })
    : finding("binary", { severity: "warn", file: file.path, detail: "binary file" });

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
      const script = startsWithShebang(file);
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

const fileContent: Scanner = ({ files }) =>
  files.flatMap((file) => {
    if (isSymlink(file.mode)) return [];
    const encoding = invalidEncoding(file, decodeText(file));
    const signature = misleadingExtension(file);
    return [
      ...(encoding ? [finding("invalid-encoding", { file: file.path, ...encoding })] : []),
      ...(signature ? [finding("misleading-extension", { file: file.path, ...signature })] : []),
    ];
  });

// A media file's bytes decode to stray code points, and agents do not read it as text.
const invisibleUnicode: Scanner = ({ files }) =>
  files.flatMap((file) => {
    const text = isMedia(file) ? undefined : decodeText(file)?.text;
    if (text === undefined) return [];
    const phrases = injections(text).map((match) => ({ line: lineAt(text, match.index) }));
    const found = invisibleCharacters(text, phrases);
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
  // Every match holds one of these, ignoring case, so a file without any skips the pattern.
  keywords?: readonly string[];
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

const NETWORK_OR_EXEC = new RegExp(
  String.raw`\bfetch\(|\brequests\.|\baxios[.(]|\bhttps?\.request\(|\bcurl\b|\bwget\b|${EXEC_SINK}|\bchild_process\b|\bsubprocess\.|\bos\.system\(`,
  "u",
);

const envSeverity: Judge = (_match, _file, text) => (NETWORK_OR_EXEC.test(text) ? "warn" : "info");

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

export const PATTERN_RULES: PatternRule[] = [
  {
    rule: "exfil-domain",
    severity: exfilSeverity,
    pattern: new RegExp(EXFIL_HOST, "giu"),
    keywords: [
      "webhook.site",
      "requestbin.com",
      "pipedream.net",
      "ngrok",
      "discord",
      "api.telegram.org/bot",
      "hooks.slack.com/services/",
    ],
  },
  {
    rule: "claude-settings",
    severity: settingsSeverity,
    pattern: /\.claude\/settings(\.local)?\.json|permissions\.allow/gu,
    keywords: [".claude/settings", "permissions.allow"],
  },
  {
    rule: "skip-permissions",
    severity: "critical",
    pattern: /--dangerously-skip-permissions/gu,
    keywords: ["dangerously-skip-permissions"],
  },
  {
    rule: "env-secrets",
    severity: envSeverity,
    pattern: new RegExp(`${CREDENTIAL_READ}|${ENV_DUMP}|${DOTENV_PATH}`, "giu"),
    keywords: ["env"],
  },
];

const KEYWORDS = new Map(
  PATTERN_RULES.flatMap(({ rule, keywords }) =>
    keywords ? [[rule, new RegExp(keywords.map(RegExp.escape).join("|"), "iu")] as const] : [],
  ),
);

export const keywordMiss = ({ rule }: PatternRule, text: string): boolean =>
  KEYWORDS.get(rule)?.test(text) === false;

const lowerIf = (demoted: boolean, severity: Severity): Severity =>
  demoted ? lower(severity) : severity;

const PROHIBITION =
  /\b(never|do not|don't|must not|should not|avoid|refuses? (requests? )?to)\s+((ever\s+)?(run|execute|use|call|invoke|type|paste|pipe|ignore|pass)(ing)?\s+(\w+\s+with\s+)?)?[`'"]?$/iu;

interface ProseContext extends ProseJudge {
  map?: MarkdownMap;
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

interface PatternMatch {
  match: RegExpExecArray;
  severity: Severity;
  quiet: boolean;
}

const patternMatches = (
  { severity, pattern }: PatternRule,
  file: SkillFile,
  text: string,
  { afterProhibition, demoted }: ProseContext,
): PatternMatch[] => {
  const judge = typeof severity === "function" ? severity : () => severity;
  return [...text.matchAll(pattern)].flatMap((match) => {
    const judged = judge(match, file, text);
    if (!judged) return [];
    const quiet = afterProhibition(match.index);
    return [{ match, severity: quiet ? "info" : lowerIf(demoted(match.index), judged), quiet }];
  });
};

const patternFinding = (
  rule: PatternRule,
  file: SkillFile,
  text: string,
  context: ProseContext,
): Finding | undefined => {
  const found = patternMatches(rule, file, text, context);
  const best = strongest(found);
  if (!best) return undefined;
  const detail = [
    best.match[0].trim(),
    ...(best.quiet ? ["(in a warning)"] : []),
    ...(found.length > 1 ? [`(${found.length} matches)`] : []),
  ].join(" ");
  return finding(rule.rule, {
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
    return PATTERN_RULES.flatMap((rule) =>
      keywordMiss(rule, text) ? [] : (patternFinding(rule, file, text, context) ?? []),
    );
  });

const DOWNLOADERS = String.raw`curl|wget|fetch|iwr|irm|invoke-webrequest|invoke-restmethod`;
const DOWNLOADS = new RegExp(String.raw`(?<![\w-])(?:${DOWNLOADERS})(?![\w-])`, "iu");
const DOWNLOADER = new RegExp(`^(?:${DOWNLOADERS})$`, "iu");
const EVAL_OF_DOWNLOAD = new RegExp(
  String.raw`(?:${EXEC_SINK}|\bnew\s+Function\s*\()[^\n]*?(?:\burlopen|\brequests\.get|(?<![.\w])fetch)\s*\(|\b(?:${EVALUATORS})\b[^\n]*?\.downloadstring\s*\(|\.downloadstring\s*\([^\n]*?\|\s*(?:${EVALUATORS})\b`,
  "iu",
);
const URLRETRIEVE = /\burlretrieve\s*\(/u;
const RUNS_PYTHON = new RegExp(String.raw`\bsubprocess\.|${EXEC_SINK}`, "u");

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
    key: (step) => step.path,
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

const downloadHits = (
  statements: Statement[],
  context: ProseContext,
): { hit: Hit; severity: Severity }[] =>
  [
    ...statements
      .filter(feedsInterpreter)
      .map((statement) => ({ statements: [statement], detail: commandText(statement) })),
    ...savedAndRun(statements),
  ]
    .toSorted((a, b) => a.statements[0]!.index - b.statements[0]!.index)
    .map((hit) => ({
      hit,
      severity: weakest(hit.statements.map((s) => statementSeverity(s, context))),
    }));

const downloadLines = (
  statements: Statement[],
  context: ProseContext,
): { severity: Severity; line: number }[] =>
  downloadHits(statements, context).flatMap(({ hit, severity }) =>
    hit.statements.map(({ line }) => ({ severity, line })),
  );

const downloadedCode: Scanner = ({ files }) =>
  files.flatMap((file) => {
    const text = decodeText(file)?.text;
    if (text === undefined || isSymlink(file.mode)) return [];
    const hits = downloadHits(shellStatements(text, isProse(file.path)), proseContext(file, text));
    const best = strongest(hits);
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

type Located = Pick<Finding, "severity" | "line" | "detail"> & Partial<Pick<Finding, "confidence">>;

const textRule =
  (rule: Rule, detect: (file: SkillFile, text: string) => Located | undefined): Scanner =>
  ({ files }) =>
    files.flatMap((file) => {
      const text = decodeText(file)?.text;
      if (text === undefined || isSymlink(file.mode)) return [];
      const found = detect(file, text);
      return found ? [finding(rule, { file: file.path, ...found })] : [];
    });

const base64ExecText = textRule("base64-exec", (file, text) =>
  base64Exec(text, shellStatements(text, isProse(file.path)), proseContext(file, text)),
);

const reverseShellText = textRule("reverse-shell", (file, text) =>
  reverseShell(text, shellStatements(text, isProse(file.path)), proseContext(file, text)),
);

const credentialPathText = textRule("credential-paths", (file, text) =>
  credentialPaths(shellStatements(text, isProse(file.path)), proseContext(file, text)),
);

const credentialDisclosureText = textRule("credential-disclosure", (file, text) => {
  if (!isProse(file.path)) return undefined;
  const context = proseContext(file, text);
  return credentialDisclosure(text, proseSentences(text, context.map), context);
});

const moneyMovementText = textRule("money-movement", (file, text) => {
  const context = proseContext(file, text);
  return moneyMovement(text, isProse(file.path) ? proseSentences(text, context.map) : [], context);
});

const persistenceText = textRule("persistence", (file, text) =>
  persistence(shellStatements(text, isProse(file.path)), proseContext(file, text)),
);

const destructiveText = textRule("destructive", (file, text) =>
  destructive(text, shellStatements(text, isProse(file.path)), proseContext(file, text)),
);

interface ParsedText {
  file: SkillFile;
  text: string;
  context: ProseContext;
  statements: Statement[];
}

type PartnerRule =
  | "curl-pipe-shell"
  | "base64-exec"
  | "persistence"
  | "destructive"
  | "money-movement";

const PARTNER_MATCHES: Record<
  PartnerRule,
  (parsed: ParsedText) => { severity: Severity; line: number }[]
> = {
  "curl-pipe-shell": ({ statements, context }) => downloadLines(statements, context),
  "base64-exec": ({ text, statements, context }) => base64ExecMatches(text, statements, context),
  persistence: ({ statements, context }) => persistenceMatches(statements, context),
  destructive: ({ text, statements, context }) => destructiveMatches(text, statements, context),
  "money-movement": ({ file, text, context }) =>
    judgePhrases(
      text,
      moneyPhrases(text, isProse(file.path) ? proseSentences(text, context.map) : []),
      context,
    ),
};

// A partner raises a match when it is above info and at most `within` lines away: 0 is the
// same line, "file" anywhere in the file.
interface Escalation {
  partners: readonly PartnerRule[];
  within: number | "file";
}

const SILENT_EXEC: Escalation = {
  partners: ["curl-pipe-shell", "base64-exec", "persistence"],
  within: "file",
};

const APPROVAL_BYPASS: Escalation = {
  partners: ["money-movement", "persistence", "destructive", "curl-pipe-shell"],
  within: 3,
};

// Partner findings anywhere in the skill raise a concealment phrase. A partner only in another
// file lowers the confidence one level.
const CONCEALMENT_PARTNERS: readonly Rule[] = [
  "curl-pipe-shell",
  "exfil-domain",
  "remote-instructions",
  "credential-paths",
  "credential-disclosure",
  "env-secrets",
  "embedded-secret",
  "url-credentials",
  "persistence",
  "money-movement",
];

// Most files match no anchor, so the partners are found only when one asks.
const escalates = (
  { partners, within }: Escalation,
  parse: () => ParsedText,
): ((line: number) => boolean) => {
  let near: ((anchor: { line: number }) => unknown) | undefined;
  return (line) => {
    if (near === undefined) {
      const parsed = parse();
      const lines = partners
        .flatMap((rule) => PARTNER_MATCHES[rule](parsed))
        .filter(({ severity }) => severity !== "info");
      near = nearest(lines, { within: within === "file" ? Infinity : within });
    }
    return near({ line }) !== undefined;
  };
};

const silentExecText = textRule("silent-exec", (file, text) => {
  const statements = shellStatements(text, isProse(file.path));
  const context = proseContext(file, text);
  return silentExec(
    text,
    statements,
    context,
    escalates(SILENT_EXEC, () => ({ file, text, context, statements })),
  );
});

const dependencySourceText = textRule("dependency-source", (file, text) =>
  dependencySource(
    shellStatements(text, isProse(file.path)),
    proseContext(file, text),
    fileName(file) === "package.json" ? text : undefined,
  ),
);

const installHookText = textRule("install-hook", (file, text) => installHook(fileName(file), text));

// `fetch` sends only as a call or before a URL, so `git fetch origin` is not a send.
const SENDS = new RegExp(
  String.raw`(?<![\w-])(?:curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod)(?![\w-])|\bfetch\s*\(|(?<![\w-])fetch[ \t]+(?:-\S+[ \t]+)*https?:\/\/|\brequests\.|${EXFIL_HOST}`,
  "iu",
);

const embeddedSecretText = textRule("embedded-secret", (_file, text) =>
  embeddedSecrets(
    text,
    text.split("\n").flatMap((line, i) => (SENDS.test(line) ? [i + 1] : [])),
  ),
);

const urlCredentialText = textRule("url-credentials", (_file, text) => urlCredentials(text));

const suppressionText = textRule("suppression-comment", (_file, text) => suppressionComments(text));

const TEXT_SCANNERS = [
  downloadedCode,
  base64ExecText,
  reverseShellText,
  suspiciousPatterns,
  remoteInstructionText,
  credentialPathText,
  credentialDisclosureText,
  embeddedSecretText,
  urlCredentialText,
  persistenceText,
  destructiveText,
  silentExecText,
  dependencySourceText,
  installHookText,
  moneyMovementText,
  suppressionText,
];

const concealing = (signals: Finding[], path: string): Confidence | undefined => {
  const partners = signals.filter(
    (signal) => signal.severity !== "info" && CONCEALMENT_PARTNERS.includes(signal.rule),
  );
  if (partners.length === 0) return undefined;
  const own = RULES["prompt-injection"].confidence;
  return partners.some((signal) => signal.file === path) ? own : lowerConfidence(own);
};

// `signals` are the other text findings of the skill, including those inside hidden text.
const promptInjectionText = (skill: ScannedSkill, signals: Finding[]): Finding[] =>
  textRule("prompt-injection", (file, text) => {
    const context = proseContext(file, text);
    return promptInjection(text, {
      ...context,
      confidence: RULES["prompt-injection"].confidence,
      concealing: concealing(signals, file.path),
      hidden: (index) => context.map?.contextAt(index) === "hidden",
      dangerNear: escalates(APPROVAL_BYPASS, () => ({
        file,
        text,
        context,
        statements: shellStatements(text, isProse(file.path)),
      })),
    });
  })(skill);

const textFindings = (skill: ScannedSkill, hidden: Finding[]): Finding[] => {
  const found = TEXT_SCANNERS.flatMap((scan) => scan(skill));
  return [...found, ...promptInjectionText(skill, [...found, ...hidden])];
};

// Hidden text scans as a plain text file: no Markdown prose context can demote it.
const scanHiddenText = (body: string): Finding[] =>
  textFindings(
    {
      name: "hidden",
      files: [{ path: "hidden.txt", content: Buffer.from(body), mode: MODE_FILE }],
    },
    [],
  );

const hiddenText = (
  { files }: ScannedSkill,
  scan: (body: string, path: string) => Finding[],
): Finding[] =>
  files.flatMap((file) => {
    const text = isMarkdown(file.path) ? decodeText(file)?.text : undefined;
    if (text === undefined || isSymlink(file.mode)) return [];
    const found = hiddenHtml(text, mapMarkdown(text).hidden, (body) => scan(body, file.path));
    return found ? [finding("hidden-html", { file: file.path, ...found })] : [];
  });

const textScan: Scanner = (skill) => {
  const insideHidden: Finding[] = [];
  const hidden = hiddenText(skill, (body, path) => {
    const found = scanHiddenText(body);
    insideHidden.push(...found.map((inside) => ({ ...inside, file: path })));
    return found;
  });
  return [...textFindings(skill, insideHidden), ...hidden];
};

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
  fileContent,
  invisibleUnicode,
  frontmatterPrivileges,
  loadTimeExecution,
  textScan,
  urlInventory,
];
