import * as p from "@clack/prompts";
import prettyBytes from "pretty-bytes";
import { onPath } from "../core/install/agents.ts";
import { byPath, decodeText, isSymlink, type SkillFile } from "../core/skill/files.ts";
import type { Changes } from "../core/source/index.ts";
import { fileLabel } from "./report.ts";
import { blue, bold, colorOn, dim, green, red } from "./style.ts";

export interface PagedSkill {
  name: string;
  files: SkillFile[];
  diff?: Changes | undefined;
}

export type Highlight = (path: string, text: string) => string;

// oxlint-disable-next-line no-control-regex -- this regex exists to find control characters.
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F]/gu;

export const escapeControl = (text: string): string =>
  text.replace(CONTROL, (char) => `^${String.fromCharCode(char.charCodeAt(0) ^ 0x40)}`);

export const numberLines: Highlight = (_path, text) =>
  text === ""
    ? ""
    : text
        .replace(/\n$/u, "")
        .split("\n")
        .map((line, index) => `${dim(String(index + 1).padStart(4))} ${line}`)
        .join("\n");

const paintLine = (line: string): string =>
  line.startsWith("@@")
    ? blue(line)
    : line.startsWith("+")
      ? green(line)
      : line.startsWith("-")
        ? red(line)
        : line;

export const colorDiff = (patch: string): string => patch.split("\n").map(paintLine).join("\n");

export const colorStat = (stat: string): string =>
  stat.replace(
    /^(.*\| *\d+ )(\+*)(-*)$/gmu,
    (_line, head: string, added: string, removed: string) =>
      `${head}${added && green(added)}${removed && red(removed)}`,
  );

const renderFile = (file: SkillFile, highlight: Highlight): string => {
  const path = escapeControl(file.path);
  const header = bold(escapeControl(fileLabel(file)));
  const text = decodeText(file)?.text;
  const body = isSymlink(file.mode)
    ? dim(`→ ${escapeControl(file.content.toString("utf8"))}`)
    : text !== undefined
      ? highlight(path, escapeControl(text))
      : dim(`binary, ${prettyBytes(file.content.length)}`);
  return body === "" ? header : `${header}\n${body}`;
};

const skillFirst = (a: SkillFile, b: SkillFile): number =>
  Number(b.path === "SKILL.md") - Number(a.path === "SKILL.md") || byPath(a, b);

const renderSkill = ({ name, files, diff }: PagedSkill, highlight: Highlight): string =>
  [
    bold(`==> ${escapeControl(name)}`),
    ...(diff?.patch ? [colorDiff(escapeControl(diff.patch.trimEnd()))] : []),
    ...files.toSorted(skillFirst).map((file) => renderFile(file, highlight)),
  ].join("\n\n");

export const renderSession = (skills: PagedSkill[], highlight: Highlight): string =>
  `${skills.map((skill) => renderSkill(skill, highlight)).join("\n\n")}\n`;

export const pagerCommand = (
  env: Record<string, string | undefined>,
): { command: string; env: { LESS: string } } => ({
  command: env.PAGER || "less",
  env: { LESS: env.LESS ?? "FRX" },
});

const bat: Highlight = (path, text) => {
  const result = Bun.spawnSync(
    [
      "bat",
      `--file-name=${path}`,
      "--style=numbers",
      "--decorations=always",
      "--wrap=never",
      "--paging=never",
      `--color=${colorOn ? "always" : "never"}`,
    ],
    { stdin: Buffer.from(text), stdout: "pipe", stderr: "ignore" },
  );
  return result.success
    ? result.stdout.toString("utf8").replace(/\n$/u, "")
    : numberLines(path, text);
};

const page = async (text: string): Promise<boolean> => {
  const { command, env } = pagerCommand(process.env);
  try {
    const child = Bun.spawn(["sh", "-c", command], {
      stdin: Buffer.from(text),
      stdout: "inherit",
      stderr: "inherit",
      env: { ...process.env, ...env },
    });
    return (await child.exited) === 0;
  } catch {
    return false;
  }
};

export const pageSkills = async (skills: PagedSkill[]): Promise<void> => {
  const session = renderSession(skills, onPath("bat") ? bat : numberLines);
  if (!(await page(session))) p.log.message(session);
};
