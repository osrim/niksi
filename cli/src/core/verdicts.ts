import { CRITICAL_EXIT } from "./scan/index.ts";
import type { Revision } from "./source/revision.ts";
import type { UpdateVerdict } from "./source/upstream.ts";

type RevisionIds = Pick<Revision, "commit" | "tag" | "pinnedAs">;

export interface CheckedSkill {
  name: string;
  source: string;
  path: string;
  track: Revision["track"];
  verdict: UpdateVerdict["kind"];
  recorded: RevisionIds;
  upstream: RevisionIds;
  error?: string;
}

const idsOf = ({ commit, tag, pinnedAs }: RevisionIds): RevisionIds => ({
  ...(commit === undefined ? {} : { commit }),
  ...(tag === undefined ? {} : { tag }),
  ...(pinnedAs === undefined ? {} : { pinnedAs }),
});

export const checkedSkill = (verdict: UpdateVerdict): CheckedSkill => {
  const { skill } = verdict;
  return {
    name: skill.name,
    source: skill.source,
    path: skill.path,
    track: skill.track,
    verdict: verdict.kind,
    recorded: idsOf(skill),
    upstream: idsOf(verdict.upstream),
    ...(verdict.kind === "unreachable" ? { error: verdict.error } : {}),
  };
};

export const checkExitCode = (verdicts: UpdateVerdict[], blocked: number): number => {
  if (blocked > 0) return CRITICAL_EXIT;
  return verdicts.every((verdict) => verdict.kind === "up-to-date") ? 0 : 1;
};
