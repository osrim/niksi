import { spyOn } from "bun:test";

export interface CapturedOutput {
  text: () => string;
  restore: () => void;
}

export const captureOutput = (): CapturedOutput => {
  const chunks: string[] = [];
  const spies = [process.stdout, process.stderr].map((stream) =>
    spyOn(stream, "write").mockImplementation(((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    }) as typeof stream.write),
  );
  return {
    text: () => Bun.stripANSI(chunks.join("")),
    restore: () => {
      for (const spy of spies) spy.mockRestore();
    },
  };
};

export const setInteractive = (interactive: boolean): (() => void) => {
  const saved = { stdin: process.stdin.isTTY, stdout: process.stdout.isTTY };
  process.stdin.isTTY = interactive;
  process.stdout.isTTY = interactive;
  return () => {
    process.stdin.isTTY = saved.stdin;
    process.stdout.isTTY = saved.stdout;
  };
};
