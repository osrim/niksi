import type { Severity } from "./index.ts";

export interface Expected {
  severity: Severity;
  // Defaults to the case path.
  file?: string;
  // Omitted means the finding has no line.
  line?: number;
  detail?: string;
}

interface CaseBase {
  name: string;
  path: string;
  content: string | Uint8Array;
  mode?: string;
  // Today's wrong result, pinned until the named entry of docs/research/ski-128-static-scan.md fixes it.
  known?: string;
}

export type Case =
  | (CaseBase & { fire: Expected[] })
  | (CaseBase & { silent: "none" | "info" | "warn" })
  | (CaseBase & { silent: Severity; known: string });

export const entry = (...body: string[]): string =>
  `---\nname: probe\ndescription: probe\n---\n${body.join("\n")}\n`;

export const frontmatter = (...fields: string[]): string =>
  `---\n${fields.join("\n")}\n---\nbody\n`;
