import { resolve } from "node:path";
import { runScanners, type Severity } from "../core/scan/index.ts";
import { LocalSource } from "../core/source/local-source.ts";
import { logWarn, renderFindings } from "../ui/report.ts";

export const run = async (directory: string): Promise<void> => {
  const source = new LocalSource(resolve(directory));
  const skills = await source.discover(undefined);
  if (skills.length === 0) throw new Error(`No skills found in ${source.dir}.`);

  const counts: Record<Severity, number> = { critical: 0, warn: 0, info: 0 };
  for (const { name, path, warnings } of skills) {
    for (const warning of warnings ?? []) logWarn(warning);
    const files = await source.fetchFiles(undefined, path);
    const findings = runScanners({ name, files });
    console.error(renderFindings(path || name, findings));
    for (const { severity } of findings) counts[severity]++;
  }
  console.log(JSON.stringify({ skills: skills.length, ...counts }));
};
