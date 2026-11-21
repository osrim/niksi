import { spyOn } from "bun:test";

export interface CapturedOutput {
  text: () => string;
  stderr: () => string;
  raw: () => string;
  restore: () => void;
}

export const captureOutput = (): CapturedOutput => {
  const chunks: { stream: NodeJS.WriteStream; text: string }[] = [];
  const spies = [process.stdout, process.stderr].map((stream) =>
    spyOn(stream, "write").mockImplementation(((chunk: unknown) => {
      chunks.push({ stream, text: String(chunk) });
      return true;
    }) as typeof stream.write),
  );
  const joined = (stream?: NodeJS.WriteStream): string =>
    chunks
      .filter((chunk) => stream === undefined || chunk.stream === stream)
      .map((chunk) => chunk.text)
      .join("");
  return {
    text: () => Bun.stripANSI(joined()),
    stderr: () => Bun.stripANSI(joined(process.stderr)),
    raw: () => joined(),
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
