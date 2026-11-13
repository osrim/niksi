import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cliRunner, type RunCli } from "../test-cli.ts";

const shippedSkillsDir = join(import.meta.dir, "..", "..", "..", "skills");

let tmp: string;
let source: string;
let project: string;
let runCli: RunCli;

beforeAll(async () => {
  tmp = await realpath(await mkdtemp(join(tmpdir(), "niksi-shipped-skills-test-")));
  source = join(tmp, "skills");
  project = join(tmp, "project");
  await cp(shippedSkillsDir, source, { recursive: true });
  await mkdir(join(project, ".git"), { recursive: true });
  runCli = cliRunner(tmp);
});

afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

interface ListedSkill {
  name: string;
  agents: string[];
  modified: boolean;
}

interface AuditedSkill {
  name: string;
  findings: { severity: string; rule: string; file?: string; line?: number }[];
}

test("the skills in skills/ install with nik add and audit with no warn or critical finding", async () => {
  const added = await runCli(project, "add", source, "--all", "-p", "--agent", "claude", "-y");
  expect(added.exitCode).toBe(0);
  expect(existsSync(join(project, ".claude", "skills", "niksi", "SKILL.md"))).toBe(true);
  const lock = JSON.parse(await readFile(join(project, "niksi-lock.json"), "utf8"));
  expect(lock.skills.niksi.agents).toEqual(["claude"]);

  const list = await runCli(project, "list", "--json");
  expect(list.exitCode).toBe(0);
  const listed = (JSON.parse(list.stdout) as { skills: ListedSkill[] }).skills;
  expect(listed.map(({ name }) => name)).toContain("niksi");
  for (const { name, agents, modified } of listed) {
    expect({ name, agents, modified }).toEqual({ name, agents: ["claude"], modified: false });
  }

  const audit = await runCli(project, "audit", "--json");
  const report = JSON.parse(audit.stdout) as {
    skills: AuditedSkill[];
    missing: string[];
    disabled: string[];
  };
  expect({ missing: report.missing, disabled: report.disabled }).toEqual({
    missing: [],
    disabled: [],
  });
  const audited = report.skills;
  expect(audited.map(({ name }) => name).toSorted()).toEqual(
    listed.map(({ name }) => name).toSorted(),
  );
  const flagged = audited.flatMap(({ name, findings }) =>
    findings
      .filter((f) => f.severity !== "info")
      .map((f) => `${name}: ${f.severity} ${f.rule} ${f.file ?? "-"}:${f.line ?? "-"}`),
  );
  expect(flagged).toEqual([]);
  expect(audit.exitCode).toBe(0);
});
