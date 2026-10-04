import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import * as p from "@clack/prompts";
import { captureOutput, setInteractive, type CapturedOutput } from "../test-output.ts";
import { fail, failNoTTY, isInteractive, requireTTY, unwrap, withSpinner } from "./prompt.ts";

let output: CapturedOutput;
let restoreTty: () => void;
let exits: number[];

beforeEach(() => {
  output = captureOutput();
  restoreTty = setInteractive(false);
  exits = [];
  spyOn(process, "exit").mockImplementation(((code?: number) => {
    exits.push(code ?? 0);
    throw new Error("exit");
  }) as typeof process.exit);
});

afterEach(() => {
  mock.restore();
  restoreTty();
});

describe("isInteractive", () => {
  test("needs a terminal on both stdin and stdout", () => {
    expect(isInteractive()).toBe(false);
    process.stdin.isTTY = true;
    expect(isInteractive()).toBe(false);
    process.stdout.isTTY = true;
    expect(isInteractive()).toBe(true);
  });
});

describe("unwrap", () => {
  test("passes an answer through", () => {
    expect(unwrap("project")).toBe("project");
    expect(exits).toEqual([]);
  });

  test("a cancelled prompt exits 130", () => {
    expect(() => unwrap(p.CANCEL_SYMBOL)).toThrow("exit");
    expect(exits).toEqual([130]);
    expect(output.text()).toContain("Cancelled.");
  });
});

describe("fail", () => {
  test("logs the message and exits 1", () => {
    expect(() => fail("broken")).toThrow("exit");
    expect(exits).toEqual([1]);
    expect(output.text()).toContain("broken");
  });
});

describe("requireTTY", () => {
  test("without a terminal it names the question and the remedy and exits 2", () => {
    expect(() => requireTTY("nik add needs confirmation", "Pass -y to proceed.")).toThrow("exit");
    expect(exits).toEqual([2]);
    expect(output.text()).toContain(
      "nik add needs confirmation, and there is no terminal to ask.\n│  Pass -y to proceed.",
    );
  });

  test("in a terminal it lets the prompt run", () => {
    setInteractive(true);
    requireTTY("nik add needs confirmation", "Pass -y to proceed.");
    expect(exits).toEqual([]);
  });

  test("failNoTTY exits 2 whether or not a terminal exists", () => {
    setInteractive(true);
    expect(() => failNoTTY("nik remove needs to know which skills", "Pass names.")).toThrow("exit");
    expect(exits).toEqual([2]);
  });
});

describe("withSpinner", () => {
  test("returns the work's result and prints the done line", async () => {
    expect(
      await withSpinner(
        "Reading",
        () => Promise.resolve(3),
        (n) => `Read ${n}`,
      ),
    ).toBe(3);
    expect(output.text()).toContain("Read 3");
  });

  test("a null done line clears the spinner instead of stopping it", async () => {
    const spinner = p.spinner();
    const clear = spyOn(spinner, "clear");
    const stop = spyOn(spinner, "stop");
    spyOn(p, "spinner").mockReturnValue(spinner);

    await withSpinner(
      "Checking",
      () => Promise.resolve(0),
      () => null,
    );

    expect(clear).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();
  });

  test("a failure marks the spinner failed and rethrows", async () => {
    await expect(
      withSpinner(
        "Fetching",
        () => Promise.reject(new Error("offline")),
        () => "done",
      ),
    ).rejects.toThrow("offline");
    expect(output.text()).toContain("Fetching: failed");
  });
});
