import { afterAll, beforeEach, expect, test } from "bun:test";
import { isAbsolute } from "node:path";
import { captureEnv } from "../test-env.ts";
import {
  cacheDir,
  claudeDir,
  configDir,
  dataDir,
  envPath,
  legacyLockPath,
  lockPath,
  storeDir,
  userHome,
} from "./paths.ts";

const HOME = "/fixture/home";
const VARS = [
  "HOME",
  "NIKSI_HOME",
  "CLAUDE_HOME",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
] as const;
const restoreEnv = captureEnv(...VARS);

beforeEach(() => {
  process.env.HOME = HOME;
  for (const name of VARS.slice(1)) delete process.env[name];
});

afterAll(restoreEnv);

test("the three roots follow the XDG base directories", () => {
  expect(dataDir()).toBe("/fixture/home/.local/share/niksi");
  expect(configDir()).toBe("/fixture/home/.config/niksi");
  expect(cacheDir()).toBe("/fixture/home/.cache/niksi");
});

test("each XDG variable moves its own root", () => {
  process.env.XDG_DATA_HOME = "/xdg/data";
  process.env.XDG_CONFIG_HOME = "/xdg/config";
  process.env.XDG_CACHE_HOME = "/xdg/cache";
  expect(dataDir()).toBe("/xdg/data/niksi");
  expect(configDir()).toBe("/xdg/config/niksi");
  expect(cacheDir()).toBe("/xdg/cache/niksi");
});

test("the store stays under the data root and the global lockfile uses config", () => {
  expect(storeDir()).toBe("/fixture/home/.local/share/niksi/store");
  expect(lockPath("global")).toBe("/fixture/home/.config/niksi/niksi-lock.json");
  expect(legacyLockPath()).toBe("/fixture/home/.local/share/niksi/niksi-lock.json");
});

test("XDG_CONFIG_HOME moves the global lockfile without moving the store", () => {
  process.env.XDG_CONFIG_HOME = "/xdg/config";
  expect(lockPath("global")).toBe("/xdg/config/niksi/niksi-lock.json");
  expect(storeDir()).toBe("/fixture/home/.local/share/niksi/store");
});

test("the project lockfile stays at the project root", () => {
  const project = lockPath("project");
  process.env.XDG_CONFIG_HOME = "/xdg/config";
  expect(lockPath("project")).toBe(project);
});

test("NIKSI_HOME replaces the data and config roots at once", () => {
  process.env.NIKSI_HOME = "/opt/niksi";
  process.env.XDG_DATA_HOME = "/xdg/data";
  process.env.XDG_CONFIG_HOME = "/xdg/config";
  expect(dataDir()).toBe("/opt/niksi");
  expect(configDir()).toBe("/opt/niksi");
  expect(storeDir()).toBe("/opt/niksi/store");
  expect(lockPath("global")).toBe("/opt/niksi/niksi-lock.json");
  expect(legacyLockPath()).toBe("/opt/niksi/niksi-lock.json");
});

test("an empty variable falls back", () => {
  process.env.NIKSI_HOME = "";
  process.env.CLAUDE_HOME = "";
  expect(dataDir()).toBe("/fixture/home/.local/share/niksi");
  expect(claudeDir()).toBe("/fixture/home/.claude");
});

test("a whitespace-only variable falls back", () => {
  process.env.NIKSI_HOME = "   ";
  expect(dataDir()).toBe("/fixture/home/.local/share/niksi");
});

test("an empty HOME reaches the system home, never a relative path", () => {
  process.env.HOME = "";
  expect(isAbsolute(userHome())).toBe(true);
  expect(isAbsolute(dataDir())).toBe(true);
});

test("a relative required variable throws", () => {
  process.env.NIKSI_HOME = "store";
  expect(() => dataDir()).toThrow('NIKSI_HOME must be an absolute path, got "store".');
});

test("a tilde path says that the shell did not expand it", () => {
  process.env.CLAUDE_HOME = "~/.claude";
  expect(() => claudeDir()).toThrow("Environment variables do not expand `~`.");
});

test("surrounding whitespace is trimmed off an absolute value", () => {
  process.env.NIKSI_HOME = " /opt/niksi ";
  expect(dataDir()).toBe("/opt/niksi");
});

test("a relative XDG variable falls back instead of throwing", () => {
  process.env.XDG_CACHE_HOME = "cache";
  process.env.XDG_DATA_HOME = "data";
  expect(cacheDir()).toBe("/fixture/home/.cache/niksi");
  expect(dataDir()).toBe("/fixture/home/.local/share/niksi");
});

test("envPath reports an absolute value unchanged", () => {
  process.env.NIKSI_HOME = "/var/lib/niksi";
  expect(envPath("NIKSI_HOME")).toBe("/var/lib/niksi");
  expect(envPath("NIKSI_NOT_SET_AT_ALL")).toBeUndefined();
});
