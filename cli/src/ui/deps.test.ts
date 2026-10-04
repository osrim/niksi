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
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyLock } from "../core/install/lockfile.ts";
import type { DiscoveredSkill } from "../core/source/discover.ts";
import { LocalSource } from "../core/source/local-source.ts";
import type { OutdatedVerdict } from "../core/source/upstream.ts";
import { makeSkill } from "../test-cli.ts";
import { captureOutput, setInteractive, type CapturedOutput } from "../test-output.ts";
import { reportUpdateDeps, resolveDeps, type DepsContext } from "./deps.ts";
import type { SkillFiles } from "./flow.ts";

let tmp: string;
let source: LocalSource;
let skills: DiscoveredSkill[];
let output: CapturedOutput;
let restoreTty: () => void;

beforeAll(async () => {
  tmp = await realpath(await mkdtemp(join(tmpdir(), "niksi-deps-test-")));
  await makeSkill(tmp, "primary", "Use /helper and /other.\n");
  await makeSkill(tmp, "helper", "Back to /primary.\n");
  await makeSkill(tmp, "other");
  await makeSkill(tmp, "risky");
  await writeFile(join(tmp, "risky", "hooks.json"), "{}\n");
  await makeSkill(tmp, "needs-risky", "Use /risky.\n");
  source = new LocalSource(tmp);
  skills = await source.discover(undefined);
});

afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  output = captureOutput();
  restoreTty = setInteractive(false);
});

afterEach(() => {
  mock.restore();
  restoreTty();
  process.exitCode = 0;
});

const printed = (): string => output.text();

const approved = (...names: string[]): Promise<SkillFiles[]> =>
  Promise.all(
    names.map(async (name) => ({
      skill: skills.find((skill) => skill.name === name)!,
      files: await source.fetchFiles(undefined, name),
    })),
  );

const context = (options: DepsContext["options"] = {}): DepsContext => ({
  source,
  rev: undefined,
  skills,
  lock: emptyLock(),
  scope: "project",
  options,
});

const names = (files: SkillFiles[]): string[] => files.map(({ skill }) => skill.name);

describe("resolveDeps", () => {
  test("without a terminal it names the mentions and installs nothing", async () => {
    const result = await resolveDeps(context(), await approved("primary"));

    expect(result).toEqual({ added: [], blocked: false });
    const text = printed();
    expect(text).toContain("primary mentions helper at SKILL.md:5. not installed.");
    expect(text).toContain(`Add them: nik add ${tmp} helper other`);
  });

  test("--yes reports instead of asking, even in a terminal", async () => {
    setInteractive(true);
    const multiselect = spyOn(p, "multiselect");

    const result = await resolveDeps(context({ yes: true }), await approved("primary"));

    expect(result.added).toEqual([]);
    expect(multiselect).not.toHaveBeenCalled();
  });

  test("a mention that is installed or in the batch is not offered", async () => {
    setInteractive(true);
    const multiselect = spyOn(p, "multiselect").mockResolvedValue([]);
    const ctx = context();
    ctx.lock.skills.other = {
      source: source.id,
      path: "other",
      integrity: "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      track: "auto",
    };

    await resolveDeps(ctx, await approved("primary", "helper"));

    expect(multiselect).not.toHaveBeenCalled();
  });

  test("each mention is offered once, and a picked one is reviewed and added", async () => {
    setInteractive(true);
    const multiselect = spyOn(p, "multiselect").mockResolvedValue(["helper"]);

    const result = await resolveDeps(context(), await approved("primary"));

    expect(multiselect).toHaveBeenCalledTimes(1);
    const [{ options }] = multiselect.mock.calls[0]!;
    expect(options.map((option) => option.value)).toEqual(["helper", "other"]);
    expect(names(result.added)).toEqual(["helper"]);
    expect(result.blocked).toBe(false);
    expect(printed()).toContain("helper: no findings");
  });

  test("a dependency goes through the gate with the batch's review options", async () => {
    setInteractive(true);
    spyOn(p, "multiselect").mockResolvedValue(["risky"]);
    const select = spyOn(p, "select").mockResolvedValue("no");

    const declined = await resolveDeps(context(), await approved("needs-risky"));
    expect(names(declined.added)).toEqual([]);
    expect(select).toHaveBeenCalledTimes(1);
    expect(Bun.stripANSI(select.mock.calls[0]![0].message)).toContain(
      "Approve risky with 1 critical finding(s)?",
    );

    const skipped = await resolveDeps(
      context({ dangerousSkipCriticalApproval: true }),
      await approved("needs-risky"),
    );
    expect(names(skipped.added)).toEqual(["risky"]);
    expect(select).toHaveBeenCalledTimes(1);
  });
});

const verdict = (name: string, from = source): OutdatedVerdict => ({
  kind: "outdated",
  skill: {
    name,
    source: from.id,
    path: name,
    integrity: "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    track: "auto",
  },
  source: from,
  upstream: { track: "auto" },
  ahead: 0,
});

const noDiff = { stat: "", patch: "" };

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
      "global",
    );

    const text = printed();
    expect(text).toContain("primary mentions helper at SKILL.md:5. not installed.");
    expect(text).toContain(`Add them: nik add ${tmp} helper other -g`);
    expect(multiselect).not.toHaveBeenCalled();
    expect(lock.skills).toEqual({});
  });

  test("a source that cannot be read skips the check with a warning", async () => {
    const gone = new LocalSource(join(tmp, "missing"));

    await reportUpdateDeps(
      [{ verdict: verdict("primary", gone), files: [], diff: noDiff }],
      emptyLock(),
      "project",
    );

    expect(printed()).toContain(
      `${join(tmp, "missing")}: dependency check skipped. no such directory: ${join(tmp, "missing")}`,
    );
  });
});
