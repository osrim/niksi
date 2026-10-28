import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CRITICAL_EXIT } from "../core/scan/index.ts";
import { emptyLock, type Lockfile } from "../core/install/lockfile.ts";
import { otherScope } from "../core/install/scope.ts";
import type { AgentId } from "../core/install/agents.ts";
import { linkSkill, writeCanonical } from "../core/install/link.ts";
import { captureEnv } from "../test-env.ts";
import type { Scope } from "../core/paths.ts";
import { selector, type DiscoveredSkill } from "../core/source/discover.ts";
import { LocalSource } from "../core/source/local-source.ts";
import { makeSkill, recordedLock } from "../test-cli.ts";
import { captureOutput, setInteractive, type CapturedOutput } from "../test-output.ts";
import type { Decisions } from "./decisions.ts";
import type { ReviewOptions } from "./gate.ts";
import { reviewNewSkills, type ReviewResult } from "./review.ts";

let tmp: string;
let source: LocalSource;
let skills: DiscoveredSkill[];
let output: CapturedOutput;
let restoreTty: () => void;
const cwd = process.cwd();
const restoreEnv = captureEnv("HOME", "NIKSI_HOME", "CLAUDE_HOME", "XDG_CONFIG_HOME");

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
  await makeSkill(tmp, "links-chain", "Read [the chain](../chain-a/SKILL.md) first.\n");
  await makeSkill(join(tmp, "pair-a"), "twin");
  await makeSkill(join(tmp, "pair-b"), "twin");
  await makeSkill(tmp, "links-twin", "Read [the twin](../pair-b/twin/SKILL.md).\n");
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

beforeEach(async () => {
  const workspace = await mkdtemp(join(tmp, "workspace-"));
  const home = join(workspace, "home");
  await mkdir(join(workspace, ".git"));
  await mkdir(home);
  process.chdir(workspace);
  process.env.HOME = home;
  process.env.NIKSI_HOME = join(home, "niksi");
  process.env.CLAUDE_HOME = join(home, ".claude");
  process.env.XDG_CONFIG_HOME = join(home, ".config");
  output = captureOutput();
  restoreTty = setInteractive(true);
});

afterEach(() => {
  process.chdir(cwd);
  restoreEnv();
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
  scope?: Scope;
  agents?: AgentId[];
  other?: Lockfile;
  script?: Script;
}

const review = async (
  selected: string[],
  { options = {}, lock, scope = "project", agents = ["claude"], other, script }: Run = {},
) => {
  const { decisions, asked, offered } = scripted(script);
  const result = await reviewNewSkills(
    {
      source,
      rev: { track: "auto" },
      root: "",
      skills,
      selected: selected.map((name) => skills.find((skill) => skill.name === name)!),
      lock: lock ?? emptyLock(),
      other: { scope: otherScope(scope), enabled: other ?? emptyLock() },
      scope,
      agents,
      options,
    },
    decisions,
  );
  return { ...summary(result), asked, offered };
};

const summary = ({ approved, declined, blocked }: ReviewResult) => ({
  approved: approved.map(({ skill }) => selector(skill)),
  declined,
  blocked,
});

const recorded = (...names: string[]): Lockfile => recordedLock(source.id, ...names);

const linked = async (
  scope: Scope,
  names: string[],
  agents: AgentId[] = ["claude"],
): Promise<Lockfile> => {
  for (const name of names) {
    await writeCanonical(name, await source.fetchFiles(undefined, name), scope);
    for (const agent of agents) await linkSkill(name, scope, agent);
  }
  return recorded(...names);
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

  test("a Markdown link to another skill's SKILL.md is offered, then that skill's own dependencies", async () => {
    const result = await review(["links-chain"], {
      script: { pick: ["chain-a", "chain-b", "chain-c"] },
    });

    expect(result.approved).toEqual(["links-chain", "chain-a", "chain-b", "chain-c"]);
    expect(result.offered).toEqual([["chain-a"], ["chain-b"], ["chain-c"]]);
  });

  test("a Markdown link to an ambiguous skill offers and adds only the linked one", async () => {
    const result = await review(["links-twin"], { script: { pick: ["twin"] } });

    expect(result.approved).toEqual(["links-twin", "pair-b/twin"]);
    expect(result.offered).toEqual([["twin"]]);
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

  test("a dependency linked globally to the selected agent is not offered, and its scope is named", async () => {
    const result = await review(["primary"], {
      other: await linked("global", ["helper"]),
      script: { pick: ["other"] },
    });

    expect(result.approved).toEqual(["primary", "other"]);
    expect(result.offered).toEqual([["other"]]);
    expect(output.text()).toContain("primary mentions helper, recorded in global scope.");
  });

  test("a global add does not offer a dependency linked to the selected agent in the project scope", async () => {
    const result = await review(["primary"], {
      scope: "global",
      other: await linked("project", ["helper", "other"]),
    });

    expect(result.offered).toEqual([]);
    expect(output.text()).toContain("primary mentions other, recorded in project scope.");
  });

  test("without a terminal a dependency linked globally to the selected agent is left out of the add command", async () => {
    setInteractive(false);

    await review(["primary"], { other: await linked("global", ["helper"]) });

    expect(output.text()).toContain("primary mentions helper, recorded in global scope.");
    expect(output.text()).toContain(`Add them: nik add ${tmp} other\n`);
  });

  test("a dependency linked globally only for another agent is still offered", async () => {
    const result = await review(["primary"], {
      other: await linked("global", ["helper"], ["universal"]),
      script: { pick: ["helper"] },
    });

    expect(result.offered).toEqual([["helper", "other"]]);
    expect(result.approved).toEqual(["primary", "helper"]);
    expect(output.text()).not.toContain("recorded in global scope");
  });

  test("an other-scope dependency must cover every selected agent", async () => {
    const result = await review(["primary"], {
      agents: ["claude", "universal"],
      other: await linked("global", ["helper"]),
    });

    expect(result.offered).toEqual([["helper", "other"]]);
  });

  test("a recorded other-scope dependency without a link is still offered", async () => {
    const result = await review(["primary"], { other: recorded("helper") });

    expect(result.offered).toEqual([["helper", "other"]]);
  });

  test("a path-copy export still offers dependencies installed for agents", async () => {
    const result = await review(["primary"], {
      agents: [],
      other: await linked("global", ["helper"]),
    });

    expect(result.offered).toEqual([["helper", "other"]]);
  });

  test("a project path copy is not available to global agents", async () => {
    const other = recorded("helper");
    Object.assign(other.skills["helper"]!, { copy: true, copyPath: "out" });
    await makeSkill(join(process.cwd(), "out"), "helper");

    const result = await review(["primary"], { scope: "global", other });

    expect(result.offered).toEqual([["helper", "other"]]);
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

  test("a non-interactive dependency hint stays inside the discovery root", async () => {
    const collection = join(tmp, "collection");
    await makeSkill(join(collection, "plugins/x"), "parent", "Use /dependency and /outside.\n");
    await makeSkill(join(collection, "plugins/x"), "dependency");
    await makeSkill(join(collection, "plugins/y"), "outside");
    const rootedSource = new LocalSource(collection);
    const discovered = await rootedSource.discover(undefined, "plugins/x");
    const result = await reviewNewSkills({
      source: rootedSource,
      rev: { track: "auto" },
      root: "plugins/x",
      skills: discovered,
      selected: discovered.filter((skill) => skill.name === "parent"),
      lock: emptyLock(),
      other: { scope: "project", enabled: emptyLock() },
      scope: "global",
      agents: ["claude"],
      options: { yes: true },
    });
    expect(result.approved.map(({ skill }) => skill.name)).toEqual(["parent"]);
    expect(output.text()).toContain(
      `Add them: nik add ${join(collection, "plugins/x")} dependency -g`,
    );
    expect(output.text()).not.toContain("mentions outside");
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
