import { lineAt } from "../skill/text.ts";

export const isMap = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const readJson = (text: string): Record<string, unknown> | Error => {
  try {
    const value: unknown = JSON.parse(text);
    return isMap(value) ? value : new Error("not a JSON object");
  } catch (e) {
    return e as Error;
  }
};

// JSON.parse keeps no positions, so a key is found as the first `"key":` at or after `from`.
export const keyIndex = (text: string, key: string, from = 0): number => {
  const quoted = JSON.stringify(key);
  const colon = /\s*:/uy;
  for (let at = text.indexOf(quoted, from); at !== -1; at = text.indexOf(quoted, at + 1)) {
    colon.lastIndex = at + quoted.length;
    if (colon.test(text)) return at;
  }
  return -1;
};

export const keyLine = (text: string, key: string, from = 0): number | undefined => {
  const at = keyIndex(text, key, from);
  return at === -1 ? undefined : lineAt(text, at);
};
