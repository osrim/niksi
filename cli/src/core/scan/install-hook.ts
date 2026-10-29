import { lineAt } from "../skill/text.ts";
import type { Finding, Severity } from "./index.ts";
import { isMap, keyIndex, keyLine, readJson } from "./manifest.ts";
import { matchDetail } from "./redact.ts";
import { strongest } from "./severity.ts";

// Flags that come before the one that takes inline code, as in `node --no-warnings -e`.
const FLAGS = String.raw`(?:[ \t]+-[\w=-]+)*?`;
const RUNS_CODE = new RegExp(
  [
    String.raw`(?<![\w-])(?:curl|wget)(?![\w-])[^\n]*?https?:\/\/`,
    String.raw`(?<![\w-])node(?:\.exe)?${FLAGS}[ \t]+(?:-[a-zA-Z]*[ep][a-zA-Z]*|--eval|--print)(?![\w-])`,
    String.raw`(?<![\w-])(?:ba|z|da)?sh${FLAGS}[ \t]+-[a-zA-Z]*c[a-zA-Z]*(?![\w-])`,
    String.raw`(?<![\w-])python[\d.]*${FLAGS}[ \t]+-[a-zA-Z]*c(?![\w-])`,
    String.raw`\|[ \t]*(?:sudo[ \t]+)?(?:ba|z|da)?sh(?![\w-])`,
  ].join("|"),
  "iu",
);
const PYTHON_DOWNLOAD = /\b(?:urlopen|urlretrieve|requests\.get)\s*\(/u;

// GuardDog's allowlist of common install scripts.
const ALLOWED = new Set([
  "husky install",
  "patch-package",
  "prisma generate",
  "npx only-allow pnpm",
  "nuxt prepare",
]);

const LIFECYCLE = ["preinstall", "install", "postinstall"];

// A cmdclass may be built in a variable first, so any install entry counts in a file that names one.
const CMDCLASS = /\bcmdclass\b/u;
const INSTALL_ENTRY =
  /["'](install)["']\s*(?:\]\s*=|:)\s*([A-Za-z_][\w.]*)|\bdict\s*\([^)]*?\b(install)\s*=\s*([A-Za-z_][\w.]*)/du;

interface Hook {
  severity: Severity;
  line?: number | undefined;
  text: string;
}

const codeSeverity = (texts: string[]): Severity =>
  texts.some((text) => RUNS_CODE.test(text)) ? "critical" : "warn";

const hookSeverity = (command: string): Severity =>
  ALLOWED.has(command.trim().replaceAll(/\s+/gu, " ")) ? "info" : codeSeverity([command]);

const unparsable = (format: string, message: string): Hook => ({
  severity: "warn",
  text: `invalid ${format}. Install hooks could not be checked. ${message}`,
});

const strings = (value: unknown): string[] => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  return isMap(value) ? Object.values(value).flatMap(strings) : [];
};

const shown = (value: unknown): string => strings(value).join(", ");

const packageHooks = (text: string): Hook[] => {
  const manifest = readJson(text);
  if (manifest instanceof Error) return [unparsable("JSON", manifest.message)];
  const scripts = manifest["scripts"];
  if (!isMap(scripts)) return [];
  const from = Math.max(keyIndex(text, "scripts"), 0);
  return LIFECYCLE.filter((event) => scripts[event] !== undefined).map((event) => {
    const value = scripts[event];
    return {
      severity: typeof value === "string" ? hookSeverity(value) : "warn",
      line: keyLine(text, event, from),
      text: `${event}: ${typeof value === "string" ? value : JSON.stringify(value)}`,
    };
  });
};

// The body of `class name` up to the next unindented line, else the whole file.
const classBody = (text: string, name: string): string => {
  const lines = text.split("\n");
  const start = lines.findIndex((line) =>
    new RegExp(String.raw`^class[ \t]+${name}\b`, "u").test(line),
  );
  if (start === -1) return text;
  const end = lines.findIndex((line, i) => i > start && /^\S/u.test(line));
  return lines.slice(start, end === -1 ? lines.length : end).join("\n");
};

const setupHooks = (text: string): Hook[] => {
  const match = CMDCLASS.test(text) ? INSTALL_ENTRY.exec(text) : null;
  if (!match) return [];
  const [start = match.index] = match.indices?.[1] ?? match.indices?.[3] ?? [];
  const command = match[2] ?? match[4] ?? "";
  const body = classBody(text, command.split(".").at(-1)!);
  return [
    {
      severity: RUNS_CODE.test(body) || PYTHON_DOWNLOAD.test(body) ? "critical" : "warn",
      line: lineAt(text, start),
      text: `cmdclass install: ${command}`,
    },
  ];
};

interface TomlHook {
  key: string;
  value: unknown;
  // Keys that lead to the hook's line, each found after the one before it.
  path: string[];
}

const at = (value: unknown, ...keys: string[]): unknown =>
  keys.reduce<unknown>((node, key) => (isMap(node) ? node[key] : undefined), value);

const entries = (value: unknown): [string, unknown][] =>
  isMap(value) ? Object.entries(value) : [];

const hatchHooks = (toml: unknown): TomlHook[] => {
  const build = at(toml, "tool", "hatch", "build");
  const scoped = (prefix: string, hooks: unknown): TomlHook[] =>
    entries(hooks).map(([name, value]) => ({
      key: `${prefix}.hooks.${name}`,
      value,
      path: [`hooks.${name}`],
    }));
  return [
    ...scoped("tool.hatch.build", at(build, "hooks")),
    ...entries(at(build, "targets")).flatMap(([target, table]) =>
      scoped(`tool.hatch.build.targets.${target}`, at(table, "hooks")),
    ),
  ];
};

const tomlHooks = (toml: unknown): TomlHook[] => {
  const poetry = at(toml, "tool", "poetry", "build");
  const script = isMap(poetry) ? poetry["script"] : poetry;
  const found: TomlHook[] = [
    ...hatchHooks(toml),
    {
      key: isMap(poetry) ? "tool.poetry.build.script" : "tool.poetry.build",
      value: script,
      path: isMap(poetry) ? ["tool.poetry.build", "script"] : ["tool.poetry", "build"],
    },
    {
      key: "tool.setuptools.cmdclass.install",
      value: at(toml, "tool", "setuptools", "cmdclass", "install"),
      path: ["cmdclass", "install"],
    },
    {
      key: "build-system.backend-path",
      value: at(toml, "build-system", "backend-path"),
      path: ["backend-path"],
    },
  ];
  return found.filter(({ value }) => value !== undefined);
};

const tomlLine = (text: string, path: string[]): number | undefined => {
  let found = -1;
  for (const key of path) {
    const escaped = key.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
    const pattern = new RegExp(String.raw`(?<![\w-])${escaped}(?![\w-])`, "gu");
    pattern.lastIndex = found + 1;
    const match = pattern.exec(text);
    if (!match) break;
    found = match.index;
  }
  return found === -1 ? undefined : lineAt(text, found);
};

const pyprojectHooks = (text: string): Hook[] => {
  let toml: unknown;
  try {
    toml = Bun.TOML.parse(text);
  } catch (e) {
    return [unparsable("TOML", (e as Error).message)];
  }
  return tomlHooks(toml).map(({ key, value, path }) => {
    const values = shown(value);
    return {
      severity: codeSeverity(strings(value)),
      line: tomlLine(text, path),
      text: values ? `${key}: ${values}` : key,
    };
  });
};

const MANIFESTS: Record<string, (text: string) => Hook[]> = {
  "package.json": packageHooks,
  "setup.py": setupHooks,
  "pyproject.toml": pyprojectHooks,
};

// `name` is the manifest's file name, without its directory.
export const installHook = (
  name: string,
  text: string,
): Pick<Finding, "severity" | "line" | "detail"> | undefined => {
  const hooks = Object.hasOwn(MANIFESTS, name) ? MANIFESTS[name]!(text) : [];
  const best = strongest(hooks);
  if (!best) return undefined;
  return {
    severity: best.severity,
    ...(best.line === undefined ? {} : { line: best.line }),
    detail: matchDetail(best.text, false, hooks.length),
  };
};
