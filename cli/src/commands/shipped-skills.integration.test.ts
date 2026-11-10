import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cliRunner, type RunCli } from "../test-cli.ts";

const shipped = join(import.meta.dir, "..", "..", "..", "skills");

let tmp: string;
let project: string;
let runCli: RunCli;

beforeAll(async () => {
  tmp = await realpath(await mkdtemp(join(tmpdir(), "niksi-shipped-skills-test-")));
  project = join(tmp, "project");
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
  const added = await runCli(project, "add", shipped, "--all", "-p", "--agent", "claude", "-y");
  expect(added.exitCode).toBe(0);

  const list = await runCli(project, "list", "--json");
  expect(list.exitCode).toBe(0);
  const listed = (JSON.parse(list.stdout) as { skills: ListedSkill[] }).skills;
  expect(listed.map(({ name, agents, modified }) => ({ name, agents, modified }))).toEqual([
    { name: "niksi", agents: ["claude"], modified: false },
    { name: "start-release", agents: ["claude"], modified: false },
  ]);

  const audit = await runCli(project, "audit", "--json");
  const audited = (JSON.parse(audit.stdout) as { skills: AuditedSkill[] }).skills;
  const flagged = audited.flatMap(({ name, findings }) =>
    findings
      .filter((f) => f.severity !== "info")
      .map((f) => `${name}: ${f.severity} ${f.rule} ${f.file ?? "-"}:${f.line ?? "-"}`),
  );
  expect(flagged).toEqual([]);
  expect(audit.exitCode).toBe(0);
});
