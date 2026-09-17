import { afterAll, beforeAll, expect, test } from "bun:test";
import type { DetectedAgent } from "../core/install/agents.ts";
import { captureEnv } from "../test-env.ts";
import { agentRows, preferredAgents, shadowNote, type AgentRow } from "./destination.ts";

const SGR = new RegExp(`${"\\u001B"}\\[[\\d;]*m`, "gu");
const plain = (text: string): string => text.replace(SGR, "");
const labels = (rows: AgentRow[]): string[] => rows.map((row) => plain(row.label));
const values = (rows: AgentRow[]): string[] => rows.map((row) => row.value);

const restoreEnv = captureEnv("HOME", "CLAUDE_HOME", "XDG_CONFIG_HOME");

beforeAll(() => {
  process.env.HOME = "/fixture/home";
  delete process.env.CLAUDE_HOME;
  delete process.env.XDG_CONFIG_HOME;
});

afterAll(() => restoreEnv());

const agent = (display: string, reads: DetectedAgent["reads"]): DetectedAgent => ({
  display,
  reads,
});
const claude = agent("Claude Code", ["claude"]);
const codex = agent("Codex", ["universal"]);
const cursor = agent("Cursor", ["universal", "claude"]);
const zed = agent("Zed", ["universal"]);
const junie = agent("Junie", ["universal"]);

const OTHER = [
  "OpenCode     ~/.config/opencode/skills",
  "Kiro         ~/.kiro/skills",
  "Cline        ~/.cline/skills",
  "Qwen Code    ~/.qwen/skills",
];

test("detected rows come first, preselected first among them, and name their agents", () => {
  const picker = agentRows("global", [claude, codex, cursor], ["universal", "claude"]);
  if (picker.kind !== "grouped") throw new Error("expected groups");
  expect(labels(picker.groups.Detected)).toEqual([
    "Universal    ~/.agents/skills           Codex, Cursor",
    "Claude Code  ~/.claude/skills           Claude Code, Cursor",
  ]);
  expect(labels(picker.groups.Other)).toEqual(OTHER);
});

test("a remembered choice moves its rows to the top of the detected group", () => {
  const picker = agentRows("global", [claude, codex, cursor], ["claude"]);
  if (picker.kind !== "grouped") throw new Error("expected groups");
  expect(labels(picker.groups.Detected)).toEqual([
    "Claude Code  ~/.claude/skills           Claude Code, Cursor",
    "Universal    ~/.agents/skills           Codex, Cursor",
  ]);
  expect(values(picker.groups.Other)).toEqual(["opencode", "kiro", "cline", "qwen"]);
});

test("with no detected agent the picker is flat, in table order", () => {
  const picker = agentRows("global", [], ["claude"]);
  if (picker.kind !== "flat") throw new Error("expected flat rows");
  expect(labels(picker.rows)).toEqual([
    "Universal    ~/.agents/skills",
    "Claude Code  ~/.claude/skills",
    ...OTHER,
  ]);
});

test("project rows show the directory relative to the project root", () => {
  const picker = agentRows("project", [claude, codex], ["claude", "universal"]);
  if (picker.kind !== "grouped") throw new Error("expected groups");
  expect(labels(picker.groups.Detected)).toEqual([
    "Universal    .agents/skills    Codex",
    "Claude Code  .claude/skills    Claude Code",
  ]);
  expect(labels(picker.groups.Other)[0]).toBe("OpenCode     .opencode/skills");
});

test("the detected group holds what a detected agent reads, the rest goes to other", () => {
  const picker = agentRows("global", [claude, codex], ["universal", "claude"]);
  if (picker.kind !== "grouped") throw new Error("expected groups");
  expect(values(picker.groups.Detected)).toEqual(["universal", "claude"]);
  expect(values(picker.groups.Other)).toEqual(["opencode", "kiro", "cline", "qwen"]);
});

test("a remembered row that nothing reads sits first in detected, with no names", () => {
  const picker = agentRows("global", [claude], ["qwen"]);
  if (picker.kind !== "grouped") throw new Error("expected groups");
  expect(labels(picker.groups.Detected)).toEqual([
    "Qwen Code    ~/.qwen/skills",
    "Claude Code  ~/.claude/skills           Claude Code",
  ]);
  expect(values(picker.groups.Other)).toEqual(["universal", "opencode", "kiro", "cline"]);
});

test("a row names at most three agents and counts the rest", () => {
  const picker = agentRows("global", [codex, cursor, zed, junie], ["universal"]);
  if (picker.kind !== "grouped") throw new Error("expected groups");
  expect(labels(picker.groups.Detected)[0]).toBe(
    "Universal    ~/.agents/skills           Codex, Cursor, Zed +1",
  );
});

test("a remembered agent set takes precedence over detection in the picker", () => {
  expect(preferredAgents("global", ["opencode", "universal"], [claude])).toEqual([
    "opencode",
    "universal",
  ]);
  expect(preferredAgents("global", undefined, [codex])).toEqual(["universal"]);
  expect(preferredAgents("global", undefined, [])).toEqual(["claude"]);
});

test("the note names the install that loses, per agent's own rule", () => {
  expect(shadowNote("project", "claude")).toBe(
    "Claude Code loads that one and ignores this install.",
  );
  expect(shadowNote("global", "claude")).toBe("Claude Code loads this one and ignores that one.");
  expect(shadowNote("project", "opencode")).toBe("OpenCode loads this one and ignores that one.");
  expect(shadowNote("global", "opencode")).toBe(
    "OpenCode loads that one and ignores this install.",
  );
  expect(shadowNote("project", "universal")).toBe("which one loads is up to the agent.");
  expect(shadowNote("project", "kiro")).toBe("Kiro loads this one and ignores that one.");
  expect(shadowNote("global", "kiro")).toBe("Kiro loads that one and ignores this install.");
  expect(shadowNote("project", "qwen")).toBe("Qwen Code loads this one and ignores that one.");
  expect(shadowNote("project", "cline")).toBe("Cline loads that one and ignores this install.");
  expect(shadowNote("global", "cline")).toBe("Cline loads this one and ignores that one.");
});
