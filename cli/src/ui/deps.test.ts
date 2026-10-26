import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import * as p from "@clack/prompts";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyLock, serializeLock, type Lockfile } from "../core/install/lockfile.ts";
import { skillsDir, type AgentId } from "../core/install/agents.ts";
import { linkSkill, writeCanonical } from "../core/install/link.ts";
import { LocalSource } from "../core/source/local-source.ts";
import type { OutdatedVerdict } from "../core/source/upstream.ts";
import { makeSkill, recordedLock } from "../test-cli.ts";
import { captureEnv } from "../test-env.ts";
import { captureOutput, setInteractive, type CapturedOutput } from "../test-output.ts";
import { readOtherScopeLock, reportNotInstalled, reportUpdateDeps } from "./deps.ts";

let tmp: string;
let source: LocalSource;
let output: CapturedOutput;
let restoreTty: () => void;
const restoreEnv = captureEnv("HOME", "NIKSI_HOME", "CLAUDE_HOME", "XDG_CONFIG_HOME", "PATH");

beforeAll(async () => {
  tmp = await realpath(await mkdtemp(join(tmpdir(), "niksi-deps-test-")));
  await makeSkill(tmp, "primary", "Use /helper and /other.\n");
  await makeSkill(tmp, "helper", "Back to /primary.\n");
  await makeSkill(tmp, "other");
  await makeSkill(tmp, "secondary", "Use /helper.\n");
  await makeSkill(tmp, "linker", "Read [helper](../helper/SKILL.md).\n");
  source = new LocalSource(tmp);
});

afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

beforeEach(async () => {
  const home = await mkdtemp(join(tmp, "home-"));
  process.env.HOME = home;
  process.env.NIKSI_HOME = join(home, "niksi");
  process.env.CLAUDE_HOME = join(home, ".claude");
  process.env.XDG_CONFIG_HOME = join(home, ".config");
  process.env.PATH = "";
  output = captureOutput();
  restoreTty = setInteractive(false);
});

afterEach(() => {
  restoreEnv();
  mock.restore();
  restoreTty();
  process.exitCode = 0;
});

const printed = (): string => output.text();

const verdict = (name: string, from = source, agents: AgentId[] = ["claude"]): OutdatedVerdict => ({
  kind: "outdated",
  skill: {
    name,
    source: from.id,
    path: name,
    integrity: "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    track: "auto",
    copy: true,
    agents,
  },
  source: from,
  upstream: { track: "auto" },
  ahead: 0,
});

const noDiff = { stat: "", patch: "" };

const recorded = (...names: string[]): Lockfile => recordedLock(source.id, ...names);

const linked = async (...agents: AgentId[]): Promise<Lockfile> => {
  await writeCanonical("helper", await source.fetchFiles(undefined, "helper"), "global");
  for (const agent of agents) await linkSkill("helper", "global", agent);
  return recorded("helper");
};

test("missing dependencies without a usable rooted coordinate warn without a broad add command", () => {
  reportNotInstalled(
    [{ from: "primary", name: "helper", file: "SKILL.md", line: 5 }],
    undefined,
    "project",
  );
  expect(printed()).toContain("primary mentions helper at SKILL.md:5. not installed.");
  expect(printed()).toContain("Cannot generate a rooted add command without a source revision.");
  expect(printed()).not.toContain("Add them:");
});

test("an ambiguous dependency appears in the add command by its path", () => {
  reportNotInstalled(
    [
      { from: "primary", name: "helper", file: "SKILL.md", line: 5 },
      { from: "primary", name: "twin", path: "b/twin", file: "SKILL.md", line: 6 },
    ],
    "o/r@main",
    "project",
  );
  expect(printed()).toContain("primary mentions twin at SKILL.md:6. not installed.");
  expect(printed()).toContain("Add them: nik add o/r@main helper b/twin\n");
});

describe("reportUpdateDeps", () => {
  test("missing dependencies are reported and never installed", async () => {
    setInteractive(true);
    const multiselect = spyOn(p, "multiselect");
    const lock = emptyLock();

    await reportUpdateDeps(
      [
        {
          verdict: verdict("primary"),
          files: await source.fetchFiles(undefined, "primary"),
          diff: noDiff,
        },
      ],
      lock,
      { scope: "project", enabled: emptyLock() },
      "global",
    );

    const text = printed();
    expect(text).toContain("primary mentions helper at SKILL.md:5. not installed.");
    expect(text).toContain(`Add them: nik add ${tmp} helper other -g`);
    expect(multiselect).not.toHaveBeenCalled();
    expect(lock.skills).toEqual({});
  });

  test("a Markdown link to another skill's SKILL.md counts as a mention", async () => {
    await reportUpdateDeps(
      [
        {
          verdict: verdict("linker"),
          files: await source.fetchFiles(undefined, "linker"),
          diff: noDiff,
        },
      ],
      emptyLock(),
      { scope: "project", enabled: emptyLock() },
      "global",
    );

    expect(printed()).toContain("linker mentions helper at SKILL.md:5. not installed.");
  });

  test("a recorded discovery root scopes the check and the add hint to that subtree", async () => {
    const collection = join(tmp, "collection");
    await makeSkill(join(collection, "plugins", "x"), "primary", "Use /helper and /friend.\n");
    await makeSkill(join(collection, "plugins", "x"), "helper");
    await makeSkill(join(collection, "plugins", "y"), "other", "Use /friend.\n");
    await makeSkill(join(collection, "plugins", "y"), "friend");
    const plugins = new LocalSource(collection);
    const rooted = (name: string, root: string): OutdatedVerdict => {
      const base = verdict(name, plugins);
      return { ...base, skill: { ...base.skill, path: `${root}/${name}`, root } };
    };

    await reportUpdateDeps(
      [
        {
          verdict: rooted("primary", "plugins/x"),
          files: await plugins.fetchFiles(undefined, "plugins/x/primary"),
          diff: noDiff,
        },
        {
          verdict: rooted("other", "plugins/y"),
          files: await plugins.fetchFiles(undefined, "plugins/y/other"),
          diff: noDiff,
        },
      ],
      emptyLock(),
      { scope: "project", enabled: emptyLock() },
      "global",
    );

    const text = printed();
    expect(text).toContain("primary mentions helper at SKILL.md:5. not installed.");
    expect(text).not.toContain("primary mentions friend");
    expect(text).toContain(`Add them: nik add ${join(collection, "plugins", "x")} helper -g`);
    expect(text).toContain(`Add them: nik add ${join(collection, "plugins", "y")} friend -g`);
  });

  test("a dependency linked globally for the selected agent is not reported missing in a project update", async () => {
    await reportUpdateDeps(
      [
        {
          verdict: verdict("primary"),
          files: await source.fetchFiles(undefined, "primary"),
          diff: noDiff,
        },
      ],
      emptyLock(),
      { scope: "global", enabled: await linked("claude") },
      "project",
    );

    const text = printed();
    expect(text).toContain("primary mentions helper, recorded in global scope.");
    expect(text).toContain(`Add them: nik add ${tmp} other\n`);
  });

  test("a dependency needed by different agents is reported for the agent without it", async () => {
    await reportUpdateDeps(
      [
        {
          verdict: verdict("primary"),
          files: await source.fetchFiles(undefined, "primary"),
          diff: noDiff,
        },
        {
          verdict: verdict("secondary", source, ["universal"]),
          files: await source.fetchFiles(undefined, "secondary"),
          diff: noDiff,
        },
      ],
      emptyLock(),
      { scope: "global", enabled: await linked("claude") },
      "project",
    );

    expect(printed()).toContain("primary mentions helper, recorded in global scope.");
    expect(printed()).toContain("secondary mentions helper at SKILL.md:5. not installed.");
    expect(printed()).toContain(`Add them: nik add ${tmp} other helper\n`);
  });

  test("an agent copy in the other scope counts only while its recorded agent has the copy", async () => {
    const other = recorded("helper");
    Object.assign(other.skills["helper"]!, { copy: true, agents: ["claude"] });
    await makeSkill(skillsDir("global", "claude"), "helper");

    await reportUpdateDeps(
      [
        {
          verdict: verdict("primary"),
          files: await source.fetchFiles(undefined, "primary"),
          diff: noDiff,
        },
      ],
      emptyLock(),
      { scope: "global", enabled: other },
      "project",
    );

    expect(printed()).toContain(`Add them: nik add ${tmp} other\n`);
    await rm(join(skillsDir("global", "claude"), "helper"), { recursive: true });
    await reportUpdateDeps(
      [
        {
          verdict: verdict("primary"),
          files: await source.fetchFiles(undefined, "primary"),
          diff: noDiff,
        },
      ],
      emptyLock(),
      { scope: "global", enabled: other },
      "project",
    );
    expect(printed()).toContain(`Add them: nik add ${tmp} helper other\n`);
  });

  test("a source that cannot be read skips the check with a warning", async () => {
    const gone = new LocalSource(join(tmp, "missing"));

    await reportUpdateDeps(
      [{ verdict: verdict("primary", gone), files: [], diff: noDiff }],
      emptyLock(),
      { scope: "global", enabled: emptyLock() },
      "project",
    );

    expect(printed()).toContain(
      `${join(tmp, "missing")}: dependency check skipped. no such directory: ${join(tmp, "missing")}`,
    );
  });
});

describe("readOtherScopeLock", () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmp, "home-"));
    process.env.NIKSI_HOME = home;
  });

  test("a project scope reads the enabled global entries", async () => {
    const lock = recorded("helper", "off");
    lock.skills["off"]!.disabled = true;
    await writeFile(join(home, "niksi-lock.json"), serializeLock(lock));

    expect(await readOtherScopeLock("project")).toEqual({
      scope: "global",
      enabled: recorded("helper"),
    });
  });

  test("an unreadable lockfile counts nothing and warns", async () => {
    await mkdir(join(home, "niksi-lock.json"));

    expect(await readOtherScopeLock("project")).toEqual({ scope: "global", enabled: emptyLock() });
    expect(printed()).toContain("Dependency check ignores global scope.");
  });
});
