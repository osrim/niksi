import { readFile } from "node:fs/promises";
import { join } from "node:path";

// A checkout with core.autocrlf writes CRLF, and the doc parsers match LF.
export const readDoc = async (name: string): Promise<string> =>
  (await readFile(join(import.meta.dir, "..", "..", "docs", name), "utf8")).replaceAll(
    "\r\n",
    "\n",
  );
