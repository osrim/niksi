import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import * as p from "@clack/prompts";
import type { Finding } from "../core/scan/index.ts";
import { MODE_FILE } from "../core/skill/files.ts";
import { captureOutput } from "../test-output.ts";
import { clackDecisions } from "./decisions.ts";
import * as pager from "./pager.ts";

const skill = {
  name: "demo",
  files: [{ path: "SKILL.md", content: Buffer.from("demo\n"), mode: MODE_FILE }],
};

const finding = (severity: Finding["severity"]): Finding => ({
  severity,
  confidence: "high",
  rule: "executable",
  help: "help",
  detail: "detail",
});

afterEach(() => {
  mock.restore();
});

describe("clackDecisions", () => {
  test("a critical stop defaults to no and a warn stop defaults to yes", async () => {
    const select = spyOn(p, "select").mockResolvedValue("yes");

    expect(await clackDecisions.approve(skill, "critical", [finding("critical")])).toBe(true);
    expect(await clackDecisions.approve(skill, "warn", [finding("warn"), finding("warn")])).toBe(
      true,
    );

    expect(select.mock.calls.map(([options]) => options.initialValue)).toEqual(["no", "yes"]);
    expect(select.mock.calls.map(([options]) => options.message)).toEqual([
      "Approve demo with 1 critical finding(s)?",
      "Continue with demo and 2 warn finding(s)?",
    ]);
  });

  test("a critical stop names the warn findings that need approval", async () => {
    const select = spyOn(p, "select").mockResolvedValue("no");

    await clackDecisions.approve(skill, "critical", [finding("warn")]);
    await clackDecisions.approve(skill, "critical", [finding("critical"), finding("warn")]);

    expect(select.mock.calls.map(([options]) => options.message)).toEqual([
      "Approve demo with 1 warn finding(s)?",
      "Approve demo with 1 critical and 1 warn finding(s)?",
    ]);
  });

  test("reading the files asks the same question again", async () => {
    const select = spyOn(p, "select").mockResolvedValueOnce("read").mockResolvedValueOnce("no");
    const paged = spyOn(pager, "pageSkills").mockResolvedValue();

    expect(await clackDecisions.approve(skill, "critical", [finding("critical")])).toBe(false);

    expect(paged).toHaveBeenCalledWith([skill]);
    expect(select).toHaveBeenCalledTimes(2);
  });

  test("dependency offers return the picked names", async () => {
    const multiselect = spyOn(p, "multiselect").mockResolvedValue(["helper"]);

    const picked = await clackDecisions.pickDependencies([
      { name: "helper", hint: "helps" },
      { name: "other", hint: "mentioned by demo" },
    ]);

    expect(picked).toEqual(["helper"]);
    const [{ options, required }] = multiselect.mock.calls[0]!;
    expect(options.map((option) => option.value)).toEqual(["helper", "other"]);
    expect(required).toBe(false);
  });

  test("cancelling exits 130", async () => {
    const output = captureOutput();
    spyOn(p, "multiselect").mockResolvedValue(p.CANCEL_SYMBOL as never);
    const exit = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exited");
    }) as typeof process.exit);

    await expect(clackDecisions.pickDependencies([{ name: "helper", hint: "" }])).rejects.toThrow(
      "exited",
    );
    output.restore();

    expect(exit).toHaveBeenCalledWith(130);
  });
});
