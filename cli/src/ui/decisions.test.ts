import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import * as p from "@clack/prompts";
import { MODE_FILE } from "../core/skill/files.ts";
import { captureOutput } from "../test-output.ts";
import { clackDecisions } from "./decisions.ts";
import * as pager from "./pager.ts";

const skill = {
  name: "demo",
  files: [{ path: "SKILL.md", content: Buffer.from("demo\n"), mode: MODE_FILE }],
};

afterEach(() => {
  mock.restore();
});

describe("clackDecisions", () => {
  test("a critical stop defaults to no and a warn stop defaults to yes", async () => {
    const select = spyOn(p, "select").mockResolvedValue("yes");

    expect(await clackDecisions.approve(skill, "critical", 1)).toBe(true);
    expect(await clackDecisions.approve(skill, "warn", 2)).toBe(true);

    expect(select.mock.calls.map(([options]) => options.initialValue)).toEqual(["no", "yes"]);
  });

  test("reading the files asks the same question again", async () => {
    const select = spyOn(p, "select").mockResolvedValueOnce("read").mockResolvedValueOnce("no");
    const paged = spyOn(pager, "pageSkills").mockResolvedValue();

    expect(await clackDecisions.approve(skill, "critical", 1)).toBe(false);

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
