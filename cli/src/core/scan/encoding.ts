import { extname } from "node:path";
import { startsWithShebang, type DecodedText, type SkillFile } from "../skill/files.ts";
import type { Finding, Severity } from "./index.ts";

const SCRIPT_EXTS = new Set([".sh", ".bash", ".zsh", ".py", ".js", ".mjs", ".cjs", ".ts"]);

export const isScriptOrMarkdown = (file: SkillFile): boolean => {
  const ext = extname(file.path).toLowerCase();
  return ext === ".md" || SCRIPT_EXTS.has(ext) || startsWithShebang(file);
};

const severityFor = (file: SkillFile): Severity => {
  if (file.path === "SKILL.md") return "critical";
  return isScriptOrMarkdown(file) ? "warn" : "info";
};

export const invalidEncoding = (
  file: SkillFile,
  decoded: DecodedText | undefined,
): Pick<Finding, "severity" | "detail"> | undefined => {
  if (!decoded?.invalid) return undefined;
  const { offset, readAs } = decoded.invalid;
  return {
    severity: severityFor(file),
    detail: `not UTF-8 at byte ${offset}${readAs === "utf-16le" ? ", read as UTF-16LE" : ""}`,
  };
};
