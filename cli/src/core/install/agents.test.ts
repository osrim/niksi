import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ancestorSkillsDirs,
  defaultAgents,
  detectAgents,
  overlapWarnings,
  parseAgentFlag,
  skillsDir,
  unreadWarnings,
  type DetectedAgent,
} from "./agents.ts";
import { captureEnv } from "../../test-env.ts";

let tmp: string;
let cwd: string;
const restoreEnv = captureEnv("HOME", "CLAUDE_HOME", "CODEX_HOME", "XDG_CONFIG_HOME", "PATH");

const resetEnv = (): void => {
  process.env.HOME = join(tmp, "home");
  delete process.env.CLAUDE_HOME;
  process.env.XDG_CONFIG_HOME = join(tmp, "no-xdg");
  process.env.PATH = join(tmp, "empty-bin");
  delete process.env.CODEX_HOME;
};

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "niksi-agents-test-"));
  cwd = process.cwd();
  resetEnv();
});

afterEach(async () => {
  process.chdir(cwd);
  await rm(join(tmp, "home"), { recursive: true, force: true });
  resetEnv();
});

afterAll(async () => {
  process.chdir(cwd);
  restoreEnv();
  await rm(tmp, { recursive: true, force: true });
});

const project = async (name: string, dirs: string[] = []): Promise<string> => {
  const root = join(tmp, name);
  await mkdir(join(root, ".git"), { recursive: true });
  for (const d of dirs) await mkdir(join(root, d), { recursive: true });
  process.chdir(root);
  return process.cwd();
};

const homeDir = async (...segments: string[]): Promise<void> => {
  await mkdir(join(tmp, "home", ...segments), { recursive: true });
};

const binary = async (name: string): Promise<void> => {
  const bin = join(tmp, "bin");
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, name), "");
  process.env.PATH = `${bin}:${join(tmp, "empty-bin")}`;
};

const detectedNames = (scope: "global" | "project" = "project"): string[] =>
  detectAgents(scope).map((agent) => agent.display);

const agent = (display: string, reads: DetectedAgent["reads"]): DetectedAgent => ({
  display,
  reads,
});

test("global targets follow $CLAUDE_HOME and $XDG_CONFIG_HOME", () => {
  process.env.CLAUDE_HOME = join(tmp, "ch");
  process.env.XDG_CONFIG_HOME = join(tmp, "xdg");
  expect(skillsDir("global", "claude")).toBe(join(tmp, "ch", "skills"));
  expect(skillsDir("global", "opencode")).toBe(join(tmp, "xdg", "opencode", "skills"));
  expect(skillsDir("global", "universal")).toBe(join(tmp, "home", ".agents", "skills"));
  expect(skillsDir("global", "kiro")).toBe(join(tmp, "home", ".kiro", "skills"));
  expect(skillsDir("global", "cline")).toBe(join(tmp, "home", ".cline", "skills"));
  expect(skillsDir("global", "qwen")).toBe(join(tmp, "home", ".qwen", "skills"));
});

test("project targets are the skills directories' dot-dirs under the project root", async () => {
  const root = await project("targets");
  expect(skillsDir("project", "claude")).toBe(join(root, ".claude", "skills"));
  expect(skillsDir("project", "opencode")).toBe(join(root, ".opencode", "skills"));
  expect(skillsDir("project", "universal")).toBe(join(root, ".agents", "skills"));
  expect(skillsDir("project", "kiro")).toBe(join(root, ".kiro", "skills"));
  expect(skillsDir("project", "cline")).toBe(join(root, ".cline", "skills"));
  expect(skillsDir("project", "qwen")).toBe(join(root, ".qwen", "skills"));
});

test("nothing on the machine detects nothing", async () => {
  await project("bare");
  expect(detectAgents("project")).toEqual([]);
  expect(detectAgents("global")).toEqual([]);
});

test("a global config dir detects its agent", async () => {
  await project("global-detect");
  process.env.CLAUDE_HOME = join(tmp, "real-claude");
  await mkdir(process.env.CLAUDE_HOME, { recursive: true });
  expect(detectedNames()).toEqual(["Claude Code"]);

  process.env.XDG_CONFIG_HOME = join(tmp, "real-xdg");
  await mkdir(join(process.env.XDG_CONFIG_HOME, "opencode"), { recursive: true });
  expect(detectedNames()).toEqual(["Claude Code", "OpenCode"]);
});

test("what the repo already uses counts too", async () => {
  await project("proj-detect", [".opencode"]);
  expect(detectedNames()).toEqual(["OpenCode"]);
});

test("an agent's home directory detects it", async () => {
  await project("home-detect");
  const homes: [string, string[]][] = [
    ["Codex", [".codex"]],
    ["Cursor", [".cursor"]],
    ["Gemini CLI", [".gemini"]],
    ["GitHub Copilot", [".copilot"]],
    ["Windsurf", [".codeium", "windsurf"]],
    ["Factory Droid", [".factory"]],
    ["Roo Code", [".roo"]],
    ["Junie", [".junie"]],
    ["Warp", [".warp"]],
    ["Kilo Code", [".kilo"]],
    ["Kilo Code", [".kilocode"]],
    ["Augment Code", [".augment"]],
    ["Trae", [".trae"]],
    ["Kiro", [".kiro"]],
    ["Cline", [".cline"]],
    ["Qwen Code", [".qwen"]],
  ];
  for (const [display, segments] of homes) {
    await rm(join(tmp, "home"), { recursive: true, force: true });
    await homeDir(...segments);
    expect(detectedNames()).toEqual([display]);
  }
});

test("XDG config dirs and $CODEX_HOME detect their agents", async () => {
  await project("xdg-detect");
  process.env.XDG_CONFIG_HOME = join(tmp, "xdg-agents");
  await mkdir(join(process.env.XDG_CONFIG_HOME, "amp"), { recursive: true });
  await mkdir(join(process.env.XDG_CONFIG_HOME, "zed"), { recursive: true });
  expect(detectedNames()).toEqual(["Amp", "Zed"]);

  process.env.XDG_CONFIG_HOME = join(tmp, "no-xdg");
  process.env.CODEX_HOME = join(tmp, "codex-home");
  await mkdir(process.env.CODEX_HOME, { recursive: true });
  expect(detectedNames()).toEqual(["Codex"]);
});

test("a project directory detects its agent", async () => {
  const dirs: [string, string][] = [
    ["Cursor", ".cursor"],
    ["Gemini CLI", ".gemini"],
    ["Windsurf", ".windsurf"],
    ["Factory Droid", ".factory"],
    ["Roo Code", ".roo"],
    ["Junie", ".junie"],
    ["Kilo Code", ".kilo"],
    ["Augment Code", ".augment"],
    ["Trae", ".trae"],
    ["Kiro", ".kiro"],
    ["Cline", ".cline"],
    ["Qwen Code", ".qwen"],
  ];
  for (const [display, dir] of dirs) {
    await project(`proj-${dir}`, [dir]);
    expect(detectedNames()).toEqual([display]);
  }
});

test("a binary on PATH detects its agent", async () => {
  await project("path-detect");
  const binaries: [string, string][] = [
    ["OpenCode", "opencode"],
    ["Codex", "codex"],
    ["Gemini CLI", "gemini"],
    ["GitHub Copilot", "copilot"],
    ["Amp", "amp"],
    ["Factory Droid", "droid"],
    ["Zed", "zed"],
    ["Warp", "warp"],
    ["Kiro", "kiro"],
  ];
  for (const [display, name] of binaries) {
    await rm(join(tmp, "bin"), { recursive: true, force: true });
    await binary(name);
    expect(detectedNames()).toEqual([display]);
  }
});

test("Antigravity, Kilo Code, and Trae are detected for project scope only", async () => {
  await project("project-only", [".kilo", ".trae"]);
  await homeDir(".gemini", "antigravity");
  expect(detectedNames("project")).toEqual(["Gemini CLI", "Antigravity", "Kilo Code", "Trae"]);
  expect(detectedNames("global")).toEqual(["Gemini CLI"]);
});

test("a detected agent carries the directories it reads in that scope", async () => {
  await project("reads", [".cline"]);
  expect(detectAgents("project")).toEqual([{ display: "Cline", reads: ["cline", "claude"] }]);
  expect(detectAgents("global")).toEqual([{ display: "Cline", reads: ["cline"] }]);
});

const claude = agent("Claude Code", ["claude"]);
const opencode = agent("OpenCode", ["universal", "claude", "opencode"]);
const codex = agent("Codex", ["universal"]);
const cursor = agent("Cursor", ["universal", "claude"]);
const zed = agent("Zed", ["universal"]);
const clineProject = agent("Cline", ["cline", "claude"]);
const clineGlobal = agent("Cline", ["cline"]);
const kiro = agent("Kiro", ["kiro"]);
const qwen = agent("Qwen Code", ["qwen"]);

test("the default is the smallest cover of the detected agents", () => {
  expect(defaultAgents("global", [claude])).toEqual(["claude"]);
  expect(defaultAgents("global", [opencode])).toEqual(["universal"]);
  expect(defaultAgents("global", [claude, opencode])).toEqual(["claude"]);
  expect(defaultAgents("global", [codex])).toEqual(["universal"]);
  expect(defaultAgents("global", [cursor])).toEqual(["universal"]);
  expect(defaultAgents("global", [claude, cursor])).toEqual(["claude"]);
  expect(defaultAgents("global", [claude, codex])).toEqual(["claude", "universal"]);
  expect(defaultAgents("global", [codex, zed])).toEqual(["universal"]);
  expect(defaultAgents("project", [clineProject])).toEqual(["cline"]);
  expect(defaultAgents("project", [claude, clineProject])).toEqual(["claude"]);
  expect(defaultAgents("global", [claude, clineGlobal])).toEqual(["claude", "cline"]);
  expect(defaultAgents("global", [kiro, qwen])).toEqual(["kiro", "qwen"]);
});

test("with no detected agent the default is claude", async () => {
  await project("kilo-global", [".kilo"]);
  expect(defaultAgents("global")).toEqual(["claude"]);
  expect(defaultAgents("global", [])).toEqual(["claude"]);
});

test("only a detected agent that reads two chosen directories warns", async () => {
  await project("overlap");
  expect(overlapWarnings(["claude", "universal"], "global", [cursor])).toEqual([
    `Cursor also reads ~/.claude/skills and ~/.agents/skills. Pick one to avoid loading skills twice.`,
  ]);
  expect(overlapWarnings(["opencode", "universal"], "project", [opencode])).toEqual([
    `OpenCode also reads .opencode/skills and .agents/skills. Pick one to avoid loading skills twice.`,
  ]);
  expect(overlapWarnings(["claude", "opencode"], "project", [claude])).toEqual([]);
  expect(overlapWarnings(["claude", "universal"], "global", [claude, codex])).toEqual([]);
  expect(overlapWarnings(["claude"], "global", [cursor])).toEqual([]);
});

test("--agent parses repeats, commas and case, and resolves agent names to ids", () => {
  expect(parseAgentFlag(undefined)).toBeNull();
  expect(parseAgentFlag("claude")).toEqual(["claude"]);
  expect(parseAgentFlag(["claude", "opencode"])).toEqual(["claude", "opencode"]);
  expect(parseAgentFlag("claude,OpenCode")).toEqual(["claude", "opencode"]);
  expect(parseAgentFlag(["claude", "claude"])).toEqual(["claude"]);
  expect(parseAgentFlag("cursor")).toEqual(["universal"]);
  expect(parseAgentFlag("Cursor")).toEqual(parseAgentFlag("cursor"));
  expect(parseAgentFlag("codex,kiro")).toEqual(["universal", "kiro"]);
  expect(parseAgentFlag("cursor,codex")).toEqual(["universal"]);
  expect(parseAgentFlag("opencode")).toEqual(["opencode"]);
});

test("--agent rejects unknown values and lists ids then agent names", () => {
  expect(() => parseAgentFlag("emacs")).toThrow(
    [
      "Unknown agent(s): emacs",
      "Ids: universal, claude, opencode, kiro, cline, qwen",
      "Agents: codex, cursor, gemini, copilot, windsurf, amp, antigravity, droid, roo, zed, junie, kilo, warp, augment, trae",
    ].join("\n"),
  );
});

test("an agent name whose home directory it does not read in the scope warns", async () => {
  await project("unread");
  expect(unreadWarnings("antigravity", "global")).toEqual([
    "Antigravity does not read ~/.agents/skills. Nothing loads in global scope.",
  ]);
  expect(unreadWarnings("antigravity", "project")).toEqual([]);
  expect(unreadWarnings("cursor,kilo", "global")).toEqual([
    "Kilo Code does not read ~/.agents/skills. Nothing loads in global scope.",
  ]);
  expect(unreadWarnings("universal", "global")).toEqual([]);
  expect(unreadWarnings(undefined, "global")).toEqual([]);
});

test("ancestor skills dirs stop at the git worktree root", async () => {
  const raw = join(tmp, "mono");
  await mkdir(join(tmp, ".claude", "skills"), { recursive: true });
  await mkdir(join(raw, ".git"), { recursive: true });
  await mkdir(join(raw, ".claude", "skills"), { recursive: true });
  await mkdir(join(raw, ".kiro", "skills"), { recursive: true });
  await mkdir(join(raw, "apps", "web", ".opencode", "skills"), { recursive: true });
  await mkdir(join(raw, "apps", "web", ".git"), { recursive: true });
  process.chdir(join(raw, "apps", "web"));
  const root = join(process.cwd(), "..", "..");

  expect(ancestorSkillsDirs()).toEqual([
    join(root, ".claude", "skills"),
    join(root, ".kiro", "skills"),
  ]);
});

test("a relative XDG_CONFIG_HOME is refused rather than redirecting the install", () => {
  process.env.XDG_CONFIG_HOME = "config";
  expect(() => skillsDir("global", "opencode")).toThrow(
    'XDG_CONFIG_HOME must be an absolute path, got "config".',
  );
});
