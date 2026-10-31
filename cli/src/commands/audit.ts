import * as p from "@clack/prompts";
import { loadLock, type LoadedLockfile } from "../core/install/lockfile.ts";
import { legacyLayoutPresent } from "../core/install/migrate.ts";
import {
  installedPath,
  installedSkills,
  locationOf,
  locationPresent,
  type InstalledSkill,
} from "../core/install/destination.ts";
import { resolveScope, scopeFlag, type ScopeOptions } from "../core/install/scope.ts";
import type { Scope } from "../core/paths.ts";
import { CRITICAL_EXIT, markAccepted, runScanners, type Finding } from "../core/scan/index.ts";
import { readDirFiles, type SkillFile } from "../core/skill/files.ts";
import { integrityOf } from "../core/skill/integrity.ts";
import type { CommandHelp } from "../ui/help.ts";
import { logFindings, logSkillError, logWarn, warn } from "../ui/report.ts";
import { emptyScopeMessage, reportDisabled } from "../ui/status.ts";
import { skillName, tildify } from "../ui/style.ts";

export const help: CommandHelp = {
  description:
    "Scan installed skills with the current rules. Exits 1 on warn findings and 3 on critical findings that the lockfile does not accept.",
  examples: ["$ nik audit", "$ nik audit -g", "$ nik audit --json"],
};

interface AuditOptions extends ScopeOptions {
  json?: boolean;
}

interface Scanned {
  skill: InstalledSkill;
  findings: Finding[];
  // The entry accepts rules, but the files on disk are not the content it accepted them for.
  modified: boolean;
}

interface Audit {
  scanned: Scanned[];
  missing: string[];
  disabled: string[];
  failed: boolean;
}

type Flag = "critical" | "warn";

const flags = (finding: Finding, flag: Flag): boolean =>
  finding.severity === flag && !finding.accepted;

const flagged = (scanned: Scanned[], flag: Flag): number =>
  scanned.filter(({ findings }) => findings.some((finding) => flags(finding, flag))).length;

const acceptedCount = (scanned: Scanned[]): number =>
  scanned.reduce(
    (sum, { findings }) => sum + findings.filter(({ accepted }) => accepted).length,
    0,
  );

const openLock = (scope: Scope): Promise<LoadedLockfile> => {
  if (legacyLayoutPresent(scope)) {
    throw new Error(
      `found files from ski 0.2. Run \`nik list${scopeFlag(scope)}\` once to move them, then audit again.`,
    );
  }
  return loadLock(scope);
};

const scanSkill = (skill: InstalledSkill, files: SkillFile[]): Scanned => {
  const findings = runScanners({ name: skill.name, files });
  const recorded = skill.review?.acceptedRules ?? [];
  if (recorded.length > 0 && integrityOf(files) !== skill.integrity) {
    return { skill, findings, modified: true };
  }
  return { skill, findings: markAccepted(findings, recorded), modified: false };
};

const auditLock = async ({ lock }: LoadedLockfile, scope: Scope): Promise<Audit> => {
  const audit: Audit = { scanned: [], missing: [], disabled: [], failed: false };
  for (const skill of installedSkills(lock)) {
    if (skill.disabled) {
      audit.disabled.push(skill.name);
      continue;
    }
    try {
      if (!locationPresent(await locationOf(skill, scope))) {
        audit.missing.push(skill.name);
        continue;
      }
      audit.scanned.push(scanSkill(skill, await readDirFiles(await installedPath(skill, scope))));
    } catch (cause) {
      logSkillError(skill.name, cause);
      audit.failed = true;
    }
  }
  return audit;
};

const setExitCode = ({ scanned, failed }: Audit): void => {
  if (flagged(scanned, "critical") > 0) process.exitCode = CRITICAL_EXIT;
  else if (failed || flagged(scanned, "warn") > 0) process.exitCode = 1;
};

export const run = async (options: AuditOptions): Promise<void> => {
  if (options.json) return runJson(options);

  p.intro("nik audit");
  const scope = resolveScope(options, p.log.warn) ?? "project";
  const loaded = await openLock(scope);
  if (Object.keys(loaded.lock.skills).length === 0) {
    p.outro(await emptyScopeMessage(scope));
    return;
  }

  p.log.step(`Scanning installed skills (${tildify(loaded.file)})`);
  const audit = await auditLock(loaded, scope);
  for (const scanned of audit.scanned) reportScanned(scanned, scope);
  reportSkipped(audit, scope);
  reportRemedy(audit, scope);
  setExitCode(audit);
  p.outro(summaryLine(audit, scope));
};

const reportScanned = ({ skill, findings, modified }: Scanned, scope: Scope): void => {
  logFindings(skill.name, findings);
  if (!modified) return;
  warn(
    `${skillName(skill.name)}: modified, so no critical finding is accepted.\nRun \`nik install${scopeFlag(scope)}\` to restore the reviewed files.`,
  );
};

const reportSkipped = ({ missing, disabled }: Audit, scope: Scope): void => {
  if (missing.length > 0) {
    p.log.info(
      `${missing.length} missing: ${missing.map(skillName).join(", ")}\nRun \`nik install${scopeFlag(scope)}\`, then audit again.`,
    );
  }
  reportDisabled(disabled, scope);
};

const reportRemedy = ({ scanned }: Audit, scope: Scope): void => {
  if (flagged(scanned, "critical") + flagged(scanned, "warn") === 0) return;
  warn(
    `Read the flagged files. Run \`nik disable${scopeFlag(scope)}\` or \`nik remove${scopeFlag(scope)}\` to stop agents loading a skill.`,
  );
};

const summaryLine = ({ scanned }: Audit, scope: Scope): string => {
  const accepted = acceptedCount(scanned);
  const notes = [
    ...(["critical", "warn"] as const).flatMap((flag) => {
      const count = flagged(scanned, flag);
      return count > 0 ? [`${count} with ${flag} findings`] : [];
    }),
    ...(accepted > 0 ? [`${accepted} accepted`] : []),
  ];
  const result = notes.length > 0 ? notes.join(", ") : "no warn or critical findings";
  return `${scanned.length} skill(s) scanned (${scope}): ${result}.`;
};

const runJson = async (options: AuditOptions): Promise<void> => {
  const scope = resolveScope(options, logWarn) ?? "project";
  const loaded = await openLock(scope);
  const audit = await auditLock(loaded, scope);
  setExitCode(audit);
  console.log(
    JSON.stringify(
      {
        scope,
        lockfile: loaded.file,
        skills: audit.scanned.map(({ skill, findings }) => ({
          name: skill.name,
          source: skill.source,
          path: skill.path,
          integrity: skill.integrity,
          findings,
        })),
        missing: audit.missing,
        disabled: audit.disabled,
      },
      null,
      2,
    ),
  );
};
