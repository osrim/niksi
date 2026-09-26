import { expect } from "bun:test";
import { join } from "node:path";

const UI = join(import.meta.dir, "ui");

// style.ts fixes its color level at import, so each color setting needs a fresh process.
export const probe = async (env: Record<string, string>, body: string): Promise<string[]> => {
  const code = `const DIR = ${JSON.stringify(UI)};\n${body}`;

  const base: Record<string, string | undefined> = { ...process.env, TERM: "xterm-256color" };
  for (const key of ["NO_COLOR", "FORCE_COLOR", "COLORTERM", "CI"]) delete base[key];

  const child = Bun.spawn(["bun", "-e", code], {
    cwd: UI,
    env: { ...base, ...env },
    stdout: "pipe",
    stderr: "inherit",
  });
  const out = await new Response(child.stdout).text();
  expect(await child.exited).toBe(0);
  return out.split("\n");
};
