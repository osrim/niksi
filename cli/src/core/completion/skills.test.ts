import { expect, test } from "bun:test";
import { recordedLock } from "../../test-cli.ts";
import { skillCandidates } from "./skills.ts";

const lock = recordedLock("https://github.com/o/r", "tdd", "grilling", "pdf");
lock.skills.pdf!.disabled = true;

test("enable offers disabled skills and disable and update offer enabled ones", () => {
  expect(skillCandidates(lock, "enable", [])).toEqual(["pdf"]);
  expect(skillCandidates(lock, "disable", [])).toEqual(["grilling", "tdd"]);
  expect(skillCandidates(lock, "update", [])).toEqual(["grilling", "tdd"]);
});

test("remove offers every recorded skill", () => {
  expect(skillCandidates(lock, "remove", [])).toEqual(["grilling", "pdf", "tdd"]);
});

test("names already on the command line are not offered again", () => {
  expect(skillCandidates(lock, "remove", ["-g", "pdf", "tdd"])).toEqual(["grilling"]);
});

test("a command without skill arguments offers nothing", () => {
  expect(skillCandidates(lock, "add", [])).toEqual([]);
  expect(skillCandidates(lock, "list", [])).toEqual([]);
});
