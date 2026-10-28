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
import type { InstalledSkill } from "../core/install/destination.ts";
import { emptyLock, serializeLock, type Lockfile } from "../core/install/lockfile.ts";
import { skillsDir, type AgentId } from "../core/install/agents.ts";
import { linkSkill, writeCanonical } from "../core/install/link.ts";
import { materialize, storeEntryPath } from "../core/install/store.ts";
import { LocalSource } from "../core/source/local-source.ts";
import type { Revision } from "../core/source/revision.ts";
import type { OutdatedVerdict } from "../core/source/upstream.ts";
import { makeSkill, recordedLock } from "../test-cli.ts";
import { captureEnv } from "../test-env.ts";
import { captureOutput, setInteractive, type CapturedOutput } from "../test-output.ts";
import { readOtherScopeLock, reportNotInstalled, reportUpdateDeps, warnReferrers } from "./deps.ts";

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

const COMMIT = "c".repeat(40);

const pinned = (name: string, upstream: Omit<Revision, "track">): OutdatedVerdict => {
  const base = verdict(name);
  return {
    ...base,
    skill: { ...base.skill, track: "pin" },
    upstream: { ...upstream, track: "pin" },
  };
};

const recorded = (...names: string[]): Lockfile => recordedLock(source.id, ...names);

const linked = async (...agents: AgentId[]): Promise<Lockfile> => {
  await writeCanonical("helper", await source.fetchFiles(undefined, "helper"), "global");
  for (const agent of agents) await linkSkill("helper", "global", agent);
  return recorded("helper");
};

test("missing dependencies without a usable rooted coordinate warn without a broad add command", () => {
  reportNotInstalled(
    [{ from: "primary", name: "helper", file: "SKILL.md", line: 5 }],
    { source: "https://github.com/o/r", root: "plugins/x" },
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
    { source: "https://github.com/o/r" },
    "project",
  );
  expect(printed()).toContain("primary mentions twin at SKILL.md:6. not installed.");
  expect(printed()).toContain("Add them: nik add https://github.com/o/r helper b/twin\n");
});

test("an ambiguous dependency path in the add command is relative to the discovery root", () => {
  reportNotInstalled(
    [{ from: "primary", name: "twin", path: "plugins/b/twin", file: "SKILL.md", line: 6 }],
    { source: "https://github.com/o/r", branch: "main", root: "plugins" },
    "project",
  );
  expect(printed()).toContain(
    "Add them: nik add https://github.com/o/r/tree/main/plugins b/twin\n",
  );
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

  test("a group of pinned skills carries the reviewed tag in the add command", async () => {
    await reportUpdateDeps(
      [
        {
          verdict: pinned("primary", { commit: COMMIT, pinnedAs: "v2.0.0", tag: "v2.0.0" }),
          files: await source.fetchFiles(undefined, "primary"),
          diff: noDiff,
        },
      ],
      emptyLock(),
      { scope: "project", enabled: emptyLock() },
      "global",
    );

    expect(printed()).toContain(`Add them: nik add ${tmp}@v2.0.0 helper other -g`);
  });

  test.each([
    ["no tag", {}],
    ["a tag that cannot follow @", { pinnedAs: "primary@v2.0.0", tag: "primary@v2.0.0" }],
    ["a tag with a slash", { pinnedAs: "release/2", tag: "release/2" }],
    ["a tag with a hash", { pinnedAs: "v2#1", tag: "v2#1" }],
    ["a tag that a shell expands", { pinnedAs: "v2.0.0+$USER", tag: "v2.0.0+$USER" }],
  ])("a pinned group with %s carries the reviewed commit", async (_, ref) => {
    await reportUpdateDeps(
      [
        {
          verdict: pinned("primary", { commit: COMMIT, ...ref }),
          files: await source.fetchFiles(undefined, "primary"),
          diff: noDiff,
        },
      ],
      emptyLock(),
      { scope: "project", enabled: emptyLock() },
      "global",
    );

    expect(printed()).toContain(`Add them: nik add ${tmp}@${COMMIT} helper other -g`);
  });

  test("a mixed group pins only the dependencies that pinned skills alone mention", async () => {
    await reportUpdateDeps(
      [
        {
          verdict: verdict("secondary"),
          files: await source.fetchFiles(undefined, "secondary"),
          diff: noDiff,
        },
        {
          verdict: pinned("primary", { commit: COMMIT, pinnedAs: "v2.0.0", tag: "v2.0.0" }),
          files: await source.fetchFiles(undefined, "primary"),
          diff: noDiff,
        },
      ],
      emptyLock(),
      { scope: "project", enabled: emptyLock() },
      "global",
    );

    expect(printed()).toContain(`Add them: nik add ${tmp} helper -g\n`);
    expect(printed()).toContain(`Add them: nik add ${tmp}@v2.0.0 other -g\n`);
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

const stored = async (name: string, body: string): Promise<InstalledSkill> => {
  const files = [{ path: "SKILL.md", content: Buffer.from(body), mode: "100644" }];
  const { integrity } = await materialize("https://github.com/o/r", name, files);
  return { name, source: "https://github.com/o/r", path: name, integrity, track: "auto" };
};

const unreadable = async (name: string): Promise<InstalledSkill> => {
  const skill = await stored(name, "hand off to /grilling");
  const entry = storeEntryPath(skill.source, skill.name, skill.integrity);
  await rm(entry, { recursive: true });
  await writeFile(entry, "not a directory");
  return skill;
};

describe("warnReferrers", () => {
  test("one line per referenced target names its sorted referrers from the store", async () => {
    const survivors = [
      await stored("wayfinder", "hand off to /grilling and /tdd"),
      await stored("implement", "run the `grilling` skill"),
    ];

    await warnReferrers(survivors, ["grilling", "tdd", "research"]);

    const text = printed();
    expect(text).toContain("grilling is referenced by implement, wayfinder");
    expect(text).toContain("tdd is referenced by wayfinder");
    expect(text).not.toContain("research");
  });

  test("a survivor missing from the store is skipped", async () => {
    const gone: InstalledSkill = {
      ...(await stored("gone", "hand off to /grilling")),
      source: "https://github.com/o/other",
    };

    await warnReferrers([gone], ["grilling"]);

    expect(printed()).toBe("");
  });

  test("a survivor whose store entry cannot be read is skipped with a warning", async () => {
    const survivors = [await unreadable("broken"), await stored("wayfinder", "then /grilling")];

    await warnReferrers(survivors, ["grilling"]);

    const text = printed();
    expect(text).toContain("broken: mention check skipped. ENOTDIR");
    expect(text).toContain("grilling is referenced by wayfinder");
  });

  test("a Markdown link to a selected skill in the same source names its referrer", async () => {
    const survivors = [
      await stored("wayfinder", "Read [it](../grilling/SKILL.md)."),
      await stored("grilling", "red, green"),
    ];

    await warnReferrers(survivors, ["grilling"]);

    expect(printed()).toContain("grilling is referenced by wayfinder");
  });

  test("a selected skill is never read", async () => {
    await warnReferrers([await unreadable("broken")], ["broken", "grilling"]);

    expect(printed()).toBe("");
  });
});
