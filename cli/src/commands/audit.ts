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
import { CRITICAL_EXIT, runScanners, type Finding, type Severity } from "../core/scan/index.ts";
import { readDirFiles } from "../core/skill/files.ts";
import type { CommandHelp } from "../ui/help.ts";
import { logFindings, logSkillError, logWarn, warn } from "../ui/report.ts";
import { emptyScopeMessage, reportDisabled } from "../ui/status.ts";
import { skillName, tildify } from "../ui/style.ts";

export const help: CommandHelp = {
  description:
    "Scan installed skills with the current rules. Exits 1 on warn findings and 3 on critical findings.",
  examples: ["$ nik audit", "$ nik audit -g", "$ nik audit --json"],
};

interface AuditOptions extends ScopeOptions {
  json?: boolean;
}

interface Scanned {
  skill: InstalledSkill;
  findings: Finding[];
}

interface Audit {
  scanned: Scanned[];
  missing: string[];
  disabled: string[];
  failed: boolean;
}

const flagged = (scanned: Scanned[], severity: Severity): number =>
  scanned.filter(({ findings }) => findings.some((finding) => finding.severity === severity))
    .length;

const openLock = (scope: Scope): Promise<LoadedLockfile> => {
  if (legacyLayoutPresent(scope)) {
    throw new Error(
      `found files from ski 0.2. Run \`nik list${scopeFlag(scope)}\` once to move them, then audit again.`,
    );
  }
  return loadLock(scope);
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
      const files = await readDirFiles(await installedPath(skill, scope));
      audit.scanned.push({ skill, findings: runScanners({ name: skill.name, files }) });
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
  for (const { skill, findings } of audit.scanned) logFindings(skill.name, findings);
  reportSkipped(audit, scope);
  reportRemedy(audit, scope);
  setExitCode(audit);
  p.outro(summaryLine(audit, scope));
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
  const notes = (["critical", "warn"] as const).flatMap((severity) => {
    const count = flagged(scanned, severity);
    return count > 0 ? [`${count} with ${severity} findings`] : [];
  });
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
