import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CRITICAL_EXIT } from "../core/scan/index.ts";
import { emptyLock, type Lockfile } from "../core/install/lockfile.ts";
import type { DiscoveredSkill } from "../core/source/discover.ts";
import { LocalSource } from "../core/source/local-source.ts";
import { makeSkill } from "../test-cli.ts";
import { captureOutput, setInteractive, type CapturedOutput } from "../test-output.ts";
import type { Decisions } from "./decisions.ts";
import type { ReviewOptions } from "./gate.ts";
import { reviewNewSkills, type ReviewResult } from "./review.ts";

let tmp: string;
let source: LocalSource;
let skills: DiscoveredSkill[];
let output: CapturedOutput;
let restoreTty: () => void;

beforeAll(async () => {
  tmp = await realpath(await mkdtemp(join(tmpdir(), "niksi-review-test-")));
  await makeSkill(tmp, "primary", "Use /helper and /other.\n");
  await makeSkill(tmp, "helper", "Back to /primary.\n");
  await makeSkill(tmp, "other");
  await makeSkill(tmp, "risky", "Use /other.\n");
  await writeFile(join(tmp, "risky", "hooks.json"), "{}\n");
  await makeSkill(tmp, "needs-risky", "Use /risky.\n");
  await makeSkill(tmp, "chain-a", "Use /chain-b.\n");
  await makeSkill(tmp, "chain-b", "Use /chain-c.\n");
  await makeSkill(tmp, "chain-c");
  await makeSkill(tmp, "hub", "Use /spoke and /helper.\n");
  await makeSkill(tmp, "spoke", "Also /helper.\n");
  await makeSkill(tmp, "scripted");
  await writeFile(join(tmp, "scripted", "run.sh"), "echo hi\n");
  await chmod(join(tmp, "scripted", "run.sh"), 0o755);
  await makeSkill(tmp, "needs-gone", "Use /gone.\n");
  await makeSkill(tmp, "gone");
  source = new LocalSource(tmp);
  skills = await source.discover(undefined);
  await rm(join(tmp, "gone"), { recursive: true });
});

afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  output = captureOutput();
  restoreTty = setInteractive(true);
});

afterEach(() => {
  output.restore();
  restoreTty();
  process.exitCode = 0;
});

interface Script {
  approve?: string[];
  pick?: string[];
}

const scripted = ({ approve = [], pick = [] }: Script = {}) => {
  const asked: string[] = [];
  const offered: string[][] = [];
  const decisions: Decisions = {
    approve: (skill) => {
      asked.push(skill.name);
      return Promise.resolve(approve.includes(skill.name));
    },
    pickDependencies: (offers) => {
      const names = offers.map((offer) => offer.name);
      offered.push(names);
      return Promise.resolve(names.filter((name) => pick.includes(name)));
    },
  };
  return { decisions, asked, offered };
};

interface Run {
  options?: ReviewOptions;
  lock?: Lockfile;
  script?: Script;
}

const review = async (selected: string[], { options = {}, lock, script }: Run = {}) => {
  const { decisions, asked, offered } = scripted(script);
  const result = await reviewNewSkills(
    {
      source,
      rev: undefined,
      skills,
      selected: selected.map((name) => skills.find((skill) => skill.name === name)!),
      lock: lock ?? emptyLock(),
      scope: "project",
      options,
    },
    decisions,
  );
  return { ...summary(result), asked, offered };
};

const summary = ({ approved, declined, blocked }: ReviewResult) => ({
  approved: approved.map(({ skill }) => skill.name),
  declined,
  blocked,
});

const recorded = (...names: string[]): Lockfile => {
  const lock = emptyLock();
  for (const name of names) {
    lock.skills[name] = {
      source: source.id,
      path: name,
      integrity: "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      track: "auto",
    };
  }
  return lock;
};

describe("reviewNewSkills", () => {
  test("an accepted skill without mentions is approved alone", async () => {
    expect(await review(["other"])).toEqual({
      approved: ["other"],
      declined: [],
      blocked: [],
      asked: [],
      offered: [],
    });
  });

  test("a picked dependency is reviewed and added, and a cycle ends after one offer", async () => {
    const result = await review(["primary"], { script: { pick: ["helper"] } });

    expect(result.approved).toEqual(["primary", "helper"]);
    expect(result.offered).toEqual([["helper", "other"]]);
  });

  test("dependencies expand transitively", async () => {
    const result = await review(["chain-a"], { script: { pick: ["chain-b", "chain-c"] } });

    expect(result.approved).toEqual(["chain-a", "chain-b", "chain-c"]);
    expect(result.offered).toEqual([["chain-b"], ["chain-c"]]);
  });

  test("a mention is offered once, even when a later dependency repeats it", async () => {
    const result = await review(["hub"], { script: { pick: ["spoke"] } });

    expect(result.approved).toEqual(["hub", "spoke"]);
    expect(result.offered).toEqual([["helper", "spoke"]]);
  });

  test("a recorded dependency is not offered", async () => {
    const result = await review(["primary"], { lock: recorded("helper", "other") });

    expect(result.approved).toEqual(["primary"]);
    expect(result.offered).toEqual([]);
  });

  test("a declined dependency leaves the approved parent", async () => {
    expect(await review(["needs-risky"], { script: { pick: ["risky"] } })).toEqual({
      approved: ["needs-risky"],
      declined: ["risky"],
      blocked: [],
      asked: ["risky"],
      offered: [["risky"]],
    });
  });

  test("an empty approval offers no dependencies", async () => {
    expect(await review(["risky"])).toEqual({
      approved: [],
      declined: ["risky"],
      blocked: [],
      asked: ["risky"],
      offered: [],
    });
  });

  test("without a terminal a critical skill is blocked while others pass, and mentions are only reported", async () => {
    setInteractive(false);

    const result = await review(["primary", "risky"], { options: { yes: true } });

    expect(result).toEqual({
      approved: ["primary"],
      declined: [],
      blocked: ["risky"],
      asked: [],
      offered: [],
    });
    expect(process.exitCode).toBe(CRITICAL_EXIT);
    expect(output.text()).toContain(`Add them: nik add ${tmp} helper other`);
  });

  test("--yes reports dependencies and accepts warn findings, but still asks about critical ones", async () => {
    const result = await review(["primary", "scripted", "risky"], {
      options: { yes: true },
      script: { approve: ["risky"] },
    });

    expect(result.approved).toEqual(["primary", "scripted", "risky"]);
    expect(result.asked).toEqual(["risky"]);
    expect(result.offered).toEqual([]);
  });

  test("without --yes a warn finding asks", async () => {
    const result = await review(["scripted"]);

    expect(result.declined).toEqual(["scripted"]);
    expect(result.asked).toEqual(["scripted"]);
  });

  test("--dangerous-skip-critical-approval also applies to an offered dependency", async () => {
    const result = await review(["needs-risky"], {
      options: { dangerousSkipCriticalApproval: true },
      script: { pick: ["risky"] },
    });

    expect(result.approved).toEqual(["needs-risky", "risky"]);
    expect(result.asked).toEqual([]);
  });

  test("a fetch failure rejects the review", async () => {
    await expect(review(["gone"])).rejects.toThrow();
    await expect(review(["needs-gone"], { script: { pick: ["gone"] } })).rejects.toThrow();
  });
});
