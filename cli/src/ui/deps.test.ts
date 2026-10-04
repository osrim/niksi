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
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyLock } from "../core/install/lockfile.ts";
import { LocalSource } from "../core/source/local-source.ts";
import type { OutdatedVerdict } from "../core/source/upstream.ts";
import { makeSkill } from "../test-cli.ts";
import { captureOutput, setInteractive, type CapturedOutput } from "../test-output.ts";
import { reportUpdateDeps } from "./deps.ts";

let tmp: string;
let source: LocalSource;
let output: CapturedOutput;
let restoreTty: () => void;

beforeAll(async () => {
  tmp = await realpath(await mkdtemp(join(tmpdir(), "niksi-deps-test-")));
  await makeSkill(tmp, "primary", "Use /helper and /other.\n");
  await makeSkill(tmp, "helper", "Back to /primary.\n");
  await makeSkill(tmp, "other");
  source = new LocalSource(tmp);
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
