import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseProjectConfig, readProjectConfig } from "./project-config.ts";
import { USAGE_ERROR } from "./usage.ts";
import { readDoc } from "../test-docs.ts";
import { captureEnv } from "../test-env.ts";

const FILE = "/work/repo/niksi.json";

let tmp: string;
const restoreEnv = captureEnv("HOME", "NIKSI_HOME");

beforeAll(async () => {
  tmp = await realpath(await mkdtemp(join(tmpdir(), "niksi-project-config-test-")));
  process.env.HOME = tmp;
  process.env.NIKSI_HOME = join(tmp, "niksi-home");
});

afterAll(async () => {
  restoreEnv();
  await rm(tmp, { recursive: true, force: true });
});

const usageErrorWith = (message: string): Error =>
  expect.objectContaining({ name: USAGE_ERROR, message }) as unknown as Error;

const thrown = (run: () => unknown): Error => {
  try {
    run();
  } catch (e) {
    return e as Error;
  }
  throw new Error("expected a throw");
};

const rejected = async (run: () => Promise<unknown>): Promise<Error> => {
  try {
    await run();
  } catch (e) {
    return e as Error;
  }
  throw new Error("expected a rejection");
};

describe("parseProjectConfig", () => {
  test("reads the cooldown and the allowed sources", () => {
    const text = JSON.stringify({
      minimumReleaseAge: 7,
      policy: {
        sources: { github: ["osrim", "anthropics"], git: ["https://git.example.com/team/skills"] },
      },
    });

    expect(parseProjectConfig(text, FILE)).toEqual({
      minimumReleaseAge: 7,
      policy: {
        sources: { github: ["osrim", "anthropics"], git: ["https://git.example.com/team/skills"] },
      },
    });
  });

  test("the example in configuration.md parses", async () => {
    const doc = await readDoc("configuration.md");
    const section = doc.split("## Project configuration\n")[1]!;
    const example = /```json\n([\s\S]*?)```/u.exec(section)![1]!;

    expect(parseProjectConfig(example, FILE)).toEqual({
      minimumReleaseAge: 7,
      policy: {
        sources: { github: ["osrim", "anthropics"], git: ["https://git.example.com/team/skills"] },
      },
    });
  });

  test("an empty object sets nothing", () => {
    expect(parseProjectConfig("{}\n", FILE)).toEqual({});
  });

  test("an empty sources object allows only local sources", () => {
    expect(parseProjectConfig('{"policy":{"sources":{}}}', FILE)).toEqual({
      policy: { sources: {} },
    });
  });

  test.each([
    ['{"scope":"project"}', "scope"],
    ['{"policy":{"denyWarn":true}}', "policy.denyWarn"],
    ['{"policy":{"requiredScope":"project"}}', "policy.requiredScope"],
    ['{"policy":{"sources":{"gitlab":["acme"]}}}', "policy.sources.gitlab"],
  ])("%s names the unknown key", (text, key) => {
    expect(() => parseProjectConfig(text, FILE)).toThrow(
      usageErrorWith(`${FILE}: unknown key ${key}`),
    );
  });

  test.each([
    ["", "not JSON"],
    ["{", "not JSON"],
    ["[]", "an array"],
    ["null", "null"],
    ['"policy"', "a string"],
  ])("%p names the file", (text) => {
    const error = thrown(() => parseProjectConfig(text, FILE));
    expect(error.name).toBe(USAGE_ERROR);
    expect(error.message).toStartWith(`${FILE}: `);
  });

  test.each([
    ['{"minimumReleaseAge":-1}', "minimumReleaseAge"],
    ['{"minimumReleaseAge":1.5}', "minimumReleaseAge"],
    ['{"minimumReleaseAge":"3"}', "minimumReleaseAge"],
    ['{"policy":[]}', "policy"],
    ['{"policy":{"sources":["osrim"]}}', "policy.sources"],
    ['{"policy":{"sources":{"github":"osrim"}}}', "policy.sources.github"],
    ['{"policy":{"sources":{"github":["osrim/skills"]}}}', "policy.sources.github"],
    ['{"policy":{"sources":{"github":[""]}}}', "policy.sources.github"],
    ['{"policy":{"sources":{"git":[""]}}}', "policy.sources.git"],
  ])("%s names the invalid key", (text, key) => {
    const error = thrown(() => parseProjectConfig(text, FILE));
    expect(error.name).toBe(USAGE_ERROR);
    expect(error.message).toStartWith(`${FILE}: ${key} `);
  });
});

const inDir = async <T>(dir: string, run: () => Promise<T>): Promise<T> => {
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    return await run();
  } finally {
    process.chdir(cwd);
  }
};

const projectWith = async (name: string, text?: string): Promise<string> => {
  const root = join(tmp, name);
  await mkdir(join(root, ".git"), { recursive: true });
  if (text !== undefined) await writeFile(join(root, "niksi.json"), text);
  return root;
};

describe("readProjectConfig", () => {
  test("reads niksi.json at the project root, from a subdirectory too", async () => {
    const root = await projectWith("reads", '{"minimumReleaseAge":5}');
    await mkdir(join(root, "docs"), { recursive: true });

    expect(await inDir(join(root, "docs"), () => readProjectConfig("project"))).toEqual({
      minimumReleaseAge: 5,
    });
  });

  test("a project without niksi.json sets nothing", async () => {
    const root = await projectWith("missing");

    expect(await inDir(root, () => readProjectConfig("project"))).toEqual({});
  });

  test("global scope never reads niksi.json", async () => {
    const root = await projectWith("global", "not json");

    expect(await inDir(root, () => readProjectConfig("global"))).toEqual({});
  });

  test("an invalid niksi.json names its path", async () => {
    const root = await projectWith("invalid", '{"policy":{"denyWarn":true}}');

    await expect(inDir(root, () => readProjectConfig("project"))).rejects.toThrow(
      usageErrorWith(`${join(root, "niksi.json")}: unknown key policy.denyWarn`),
    );
  });

  test("a directory named niksi.json names its path", async () => {
    const root = await projectWith("directory");
    await mkdir(join(root, "niksi.json"));

    const error = await rejected(() => inDir(root, () => readProjectConfig("project")));
    expect(error.name).toBe(USAGE_ERROR);
    expect(error.message).toStartWith(`${join(root, "niksi.json")}: `);
  });
});
