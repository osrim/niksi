import { expect, test } from "bun:test";
import { credentialPaths } from "./credential-paths.ts";
import { shellStatements } from "./shell.ts";

const plain = { afterProhibition: () => false, demoted: () => false };

const inScript = (...lines: string[]) =>
  credentialPaths(shellStatements(lines.join("\n"), false), plain);

const inMarkdown = (text: string, context = plain) =>
  credentialPaths(shellStatements(text, true), context);

test("every home spelling names the same store", () => {
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
  expect(inMarkdown("Run `cat ~/.netrc`.", { ...plain, demoted: () => true })).toEqual({
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

test("a store inside a URL is not a path", () => {
  expect(inScript("curl https://host.dev/home/ada/.aws/credentials")).toBeUndefined();
});
