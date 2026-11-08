import { join } from "node:path";
import writeFileAtomic from "write-file-atomic";
import { integrityOfDir } from "../skill/integrity.ts";
import type { Revision } from "../source/revision.ts";
import { AGENT_IDS, type AgentId } from "./agents.ts";
import type { LockEntry, Lockfile } from "./lockfile.ts";

export interface AdoptPlan {
  name: string;
  source: string;
  path: string;
  root?: string | undefined;
  revision: Revision;
  integrity: string;
  agents: AgentId[];
  dirs: string[];
  scannedIntegrity: string;
  // A gh skill copy differs from its source only in SKILL.md.
  skillMd?: Buffer;
  acceptedRules: string[];
}

const assertUnchanged = async (plan: AdoptPlan): Promise<void> => {
  for (const dir of plan.dirs) {
    if ((await integrityOfDir(dir)) !== plan.scannedIntegrity) {
      throw new Error(`${dir} changed since the scan.\nRun nik adopt again.`);
    }
  }
};

export const adoptSkill = async (plan: AdoptPlan, lock: Lockfile): Promise<void> => {
  if (lock.skills[plan.name] !== undefined) throw new Error("already recorded");
  await assertUnchanged(plan);
  if (plan.skillMd !== undefined && plan.integrity !== plan.scannedIntegrity) {
    for (const dir of plan.dirs) await writeFileAtomic(join(dir, "SKILL.md"), plan.skillMd);
  }
  const entry: LockEntry = {
    source: plan.source,
    path: plan.path,
    ...(plan.root ? { root: plan.root } : {}),
    ...plan.revision,
    integrity: plan.integrity,
    copy: true,
    agents: AGENT_IDS.filter((agent) => plan.agents.includes(agent)),
    ...(plan.acceptedRules.length > 0 ? { review: { acceptedRules: plan.acceptedRules } } : {}),
  };
  lock.skills[plan.name] = entry;
};
