import type { SkillFile } from "../skill/files.ts";
import { integrityOfDir } from "../skill/integrity.ts";
import type { Revision } from "../source/revision.ts";
import { AGENT_IDS, type AgentId } from "./agents.ts";
import type { LockEntry, Lockfile } from "./lockfile.ts";
import { replaceDir } from "./replace.ts";

export interface AdoptPlan {
  name: string;
  source: string;
  path: string;
  root?: string | undefined;
  revision: Revision;
  integrity: string;
  agents: AgentId[];
  dirs: string[];
  // The integrity of the copies when they were scanned.
  local: string;
  // Upstream files to write over copies that hold equivalent content, such as gh skill copies.
  files?: SkillFile[];
  acceptedRules: string[];
}

const assertUnchanged = async (plan: AdoptPlan): Promise<void> => {
  for (const dir of plan.dirs) {
    if ((await integrityOfDir(dir)) !== plan.local) {
      throw new Error(`${dir} changed since the scan. Run nik adopt again.`);
    }
  }
};

// Records copies that are already on disk as an agent copy entry. Only an upstream rewrite writes files.
export const adoptSkill = async (
  plan: AdoptPlan,
  lock: Lockfile,
): Promise<{ leftovers: string[] }> => {
  if (lock.skills[plan.name] !== undefined) throw new Error("already recorded");
  await assertUnchanged(plan);
  const leftovers: string[] = [];
  if (plan.files !== undefined && plan.integrity !== plan.local) {
    for (const dir of plan.dirs) {
      const leftover = await replaceDir(dir, plan.files);
      if (leftover !== undefined) leftovers.push(leftover);
    }
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
  return { leftovers };
};
