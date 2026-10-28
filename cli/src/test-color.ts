import { expect } from "bun:test";
import { join } from "node:path";

const UI = join(import.meta.dir, "ui");

const probeCode = (body: string): string => `const DIR = ${JSON.stringify(UI)};\n${body}`;

const probeEnv = (env: Record<string, string>): Record<string, string | undefined> => {
  const base: Record<string, string | undefined> = { ...process.env, TERM: "xterm-256color" };
  for (const key of ["NO_COLOR", "FORCE_COLOR", "COLORTERM", "CI"]) delete base[key];
  return { ...base, ...env };
};

// style.ts fixes its color level at import, so each color setting needs a fresh process.
export const probe = async (env: Record<string, string>, body: string): Promise<string[]> => {
  const child = Bun.spawn(["bun", "-e", probeCode(body)], {
    cwd: UI,
    env: probeEnv(env),
    stdout: "pipe",
    stderr: "inherit",
  });
  const out = await new Response(child.stdout).text();
  expect(await child.exited).toBe(0);
  return out.split("\n");
};

export const probeTerminal = async (env: Record<string, string>, body: string): Promise<string> => {
  const decoder = new TextDecoder();
  let out = "";
  const child = Bun.spawn(["bun", "-e", probeCode(body)], {
    cwd: UI,
    env: probeEnv(env),
    terminal: {
      data(_terminal, data) {
        out += decoder.decode(data, { stream: true });
      },
    },
  });
  expect(await child.exited).toBe(0);
  child.terminal?.close();
  return out + decoder.decode();
};
