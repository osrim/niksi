import { expect, test } from "bun:test";
import { suppressionComments } from "./suppression.ts";

test("each author-side suppression marker is found", () => {
  for (const marker of [
    "token = 'x'  # gitleaks:allow",
    "key = 'x'  # pragma: allowlist secret",
    "subprocess.call(cmd, shell=True)  # nosec",
    "# shellcheck disable=SC2086",
    "/* eslint-disable no-eval */",
    "// eslint-disable-next-line no-eval",
    "import os  # noqa: F401",
  ]) {
    expect(suppressionComments(marker)?.severity).toBe("info");
  }
});

test("one finding per file names the first marker and the count", () => {
  expect(suppressionComments("a\nrun()  # nosec\nb  # NOQA\n")).toEqual({
    severity: "info",
    line: 2,
    detail: "# nosec (2 matches)",
  });
});

test("words that only contain a marker are not one", () => {
  expect(
    suppressionComments("nosecurity checks; the noqa_style flag; shellcheck it"),
  ).toBeUndefined();
});

test("a marker stays on one line", () => {
  expect(suppressionComments("## Modes\nnosec mode is off\n")).toBeUndefined();
});
