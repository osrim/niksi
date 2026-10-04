import * as p from "@clack/prompts";
import { pageSkills, type PagedSkill } from "./pager.ts";
import { unwrap } from "./prompt.ts";
import { skillName } from "./style.ts";

export interface DependencyOffer {
  name: string;
  hint: string;
}

export interface Decisions {
  approve: (skill: PagedSkill, stop: "critical" | "warn", count: number) => Promise<boolean>;
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

export const clackDecisions: Decisions = {
  approve: (skill, stop, count) =>
    stop === "critical"
      ? ask(`Approve ${skillName(skill.name)} with ${count} critical finding(s)?`, false, [skill])
      : ask(`Continue with ${skillName(skill.name)} and ${count} warn finding(s)?`, true, [skill]),
  pickDependencies: async (offers) =>
    unwrap(
      await p.multiselect<string>({
        message: "Add these dependencies?",
        options: offers.map(({ name, hint }) => ({ value: name, label: name, hint })),
        required: false,
      }),
    ),
};
