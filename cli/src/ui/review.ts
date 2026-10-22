import type { Lockfile } from "../core/install/lockfile.ts";
import type { AgentId } from "../core/install/agents.ts";
import type { Scope } from "../core/paths.ts";
import { missingDeps, type MissingDep } from "../core/skill/deps.ts";
import type { DiscoveredSkill } from "../core/source/discover.ts";
import { discoveryCoordinate, type Source } from "../core/source/index.ts";
import type { Revision } from "../core/source/revision.ts";
import { clackDecisions, type Decisions, type DependencyOffer } from "./decisions.ts";
import {
  reportNotInstalled,
  reportRecordedElsewhere,
  warnMentions,
  type OtherScopeLock,
} from "./deps.ts";
import { fetchSkillFiles, type SkillFiles } from "./flow.ts";
import { reviewSkills, type ReviewOptions } from "./gate.ts";
import { isInteractive } from "./prompt.ts";
import { logSourceCaution } from "./report.ts";
import { summarize } from "./style.ts";

export interface ReviewRequest {
  source: Source;
  rev: Revision;
  root: string;
  skills: DiscoveredSkill[];
  selected: DiscoveredSkill[];
  lock: Lockfile;
  other: OtherScopeLock;
  scope: Scope;
  agents: AgentId[];
  options: ReviewOptions;
}

export interface ReviewResult {
  approved: SkillFiles[];
  declined: string[];
  blocked: string[];
}

const reviewBatch = async (
  request: ReviewRequest,
  batch: DiscoveredSkill[],
  decisions: Decisions,
  result: ReviewResult,
): Promise<number> => {
  const fetched = await fetchSkillFiles(request.source, request.rev.commit, batch);
  const review = await reviewSkills(
    fetched.map(({ skill, files }) => ({
      name: skill.name,
      files,
      warnings: skill.warnings ?? [],
      skill,
    })),
    request.options,
    decisions,
  );
  result.approved.push(...review.approved.map(({ skill, files }) => ({ skill, files })));
  result.declined.push(...review.declined.map(({ name }) => name));
  result.blocked.push(...review.blocked.map(({ name }) => name));
  return review.approved.length;
};

const offerFor = (request: ReviewRequest, dep: MissingDep): DependencyOffer => {
  const skill = request.skills.find((candidate) => candidate.name === dep.name)!;
  return { name: dep.name, hint: summarize(skill.description) ?? `mentioned by ${dep.from}` };
};

const expandDependencies = async (
  request: ReviewRequest,
  decisions: Decisions,
  result: ReviewResult,
): Promise<void> => {
  const known = request.skills.map((skill) => skill.name);
  const interactive = !request.options.yes && isInteractive();
  const offered = new Set<string>();

  for (;;) {
    const mentioned = missingDeps(
      result.approved.map(({ skill, files }) => ({ name: skill.name, files })),
      known,
      (name) => offered.has(name) || request.lock.skills[name] !== undefined,
    );
    for (const dep of mentioned) offered.add(dep.name);
    const missing = await reportRecordedElsewhere(mentioned, request.other, request.agents);
    if (missing.length === 0) return;

    if (!interactive) {
      reportNotInstalled(
        missing,
        discoveryCoordinate({ source: request.source.id, root: request.root, ...request.rev }),
        request.scope,
      );
      return;
    }
    warnMentions(missing, "not installed");

    const picked = new Set(
      await decisions.pickDependencies(missing.map((dep) => offerFor(request, dep))),
    );
    if (picked.size === 0) return;
    const batch = request.skills.filter((skill) => picked.has(skill.name));
    await reviewBatch(request, batch, decisions, result);
  }
};

export const reviewNewSkills = async (
  request: ReviewRequest,
  decisions: Decisions = clackDecisions,
): Promise<ReviewResult> => {
  logSourceCaution();
  const result: ReviewResult = { approved: [], declined: [], blocked: [] };
  const approved = await reviewBatch(request, request.selected, decisions, result);
  if (approved > 0) await expandDependencies(request, decisions, result);
  return result;
};
