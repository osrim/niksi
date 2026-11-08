import * as p from "@clack/prompts";
import type { Finding } from "../core/scan/index.ts";
import { pageSkills, type PagedSkill } from "./pager.ts";
import { unwrap } from "./prompt.ts";
import { skillName } from "./style.ts";

export interface DependencyOffer {
  name: string;
  hint: string;
}

export interface Decisions {
  approve: (skill: PagedSkill, stop: "critical" | "warn", findings: Finding[]) => Promise<boolean>;
  pickDependencies: (offers: DependencyOffer[]) => Promise<string[]>;
}

type Answer = "yes" | "no" | "read";

export const ask = async (
  message: string,
  initialValue: boolean,
  reading: PagedSkill[],
): Promise<boolean> => {
  if (reading.length === 0) return unwrap(await p.confirm({ message, initialValue }));
  for (;;) {
    const answer = unwrap(
      await p.select<Answer>({
        message,
        initialValue: initialValue ? "yes" : "no",
        options: [
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" },
          { value: "read", label: "Read files…", hint: "press q to return" },
        ],
      }),
    );
    if (answer !== "read") return answer === "yes";
    await pageSkills(reading);
  }
};

const counted = (findings: Finding[]): string => {
  const counts = (["critical", "warn"] as const).flatMap((severity) => {
    const count = findings.filter((finding) => finding.severity === severity).length;
    return count === 0 ? [] : [`${count} ${severity}`];
  });
  return `${counts.join(" and ")} finding(s)`;
};

export const clackDecisions: Decisions = {
  approve: (skill, stop, findings) =>
    stop === "critical"
      ? ask(`Approve ${skillName(skill.name)} with ${counted(findings)}?`, false, [skill])
      : ask(`Continue with ${skillName(skill.name)} and ${counted(findings)}?`, true, [skill]),
  pickDependencies: async (offers) =>
    unwrap(
      await p.multiselect<string>({
        message: "Add these dependencies?",
        options: offers.map(({ name, hint }) => ({ value: name, label: name, hint })),
        required: false,
      }),
    ),
};
