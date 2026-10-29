import { expect, test } from "bun:test";
import { linkMismatch } from "./link-mismatch.ts";

const check = (text: string) => linkMismatch(text, (target) => target.startsWith("webhook.site"));

test("link text naming one host while the target runs a script elsewhere is critical", () => {
  expect(
    check(
      "Intro.\n\nSee [github.com/acme/setup](https://raw.githubusercontent.com/evil/setup.sh)\n",
    ),
  ).toEqual({
    severity: "critical",
    line: 3,
    detail: "github.com/acme/setup → https://raw.githubusercontent.com/evil/setup.sh",
  });
});

test("a .py or .ps1 target, or an exfiltration host, is critical", () => {
  expect(check("[pypi.org](https://evil.dev/x.py)")?.severity).toBe("critical");
  expect(check("[https://docs.acme.dev](https://evil.dev/run.PS1?x=1)")?.severity).toBe("critical");
  expect(check("[acme.dev/hook](https://webhook.site/abc)")?.severity).toBe("critical");
});

test("an exfiltration host named only in the query is warn", () => {
  expect(check("[acme.dev](https://evil.dev/x?u=webhook.site)")?.severity).toBe("warn");
});

test("any other host mismatch is warn, and the line counts soft breaks", () => {
  expect(check("one\ntwo [www.acme.dev](https://evil.dev/docs)\n")).toEqual({
    severity: "warn",
    line: 2,
    detail: "www.acme.dev → https://evil.dev/docs",
  });
});

test("the strongest mismatch leads, with the count", () => {
  expect(check("[a.com](https://b.com)\n\n[c.com](https://d.com/x.sh)\n")?.detail).toBe(
    "c.com → https://d.com/x.sh (2 matches)",
  );
});

test("the same host, a subdomain, and `www.` pass", () => {
  expect(check("[docs.acme.dev](https://acme.dev/docs)")).toBeUndefined();
  expect(check("[acme.dev](https://docs.acme.dev)")).toBeUndefined();
  expect(check("[www.GitHub.com/x](https://github.com/x)")).toBeUndefined();
});

test("text that is not a host is not compared", () => {
  expect(check("[Acme docs](https://acme.dev/docs)")).toBeUndefined();
  expect(
    check("[install.sh](https://raw.githubusercontent.com/acme/x/install.sh)"),
  ).toBeUndefined();
  expect(check("[see github.com for more](https://evil.dev)")).toBeUndefined();
  expect(check("[`SKILL.md`](https://github.com/acme/x/blob/main/SKILL.md)")).toBeUndefined();
});

test("a protocol-relative target is compared like an https: one", () => {
  expect(check("See [github.com/acme/setup](//evil.invalid/setup.sh)")).toEqual({
    severity: "critical",
    line: 1,
    detail: "github.com/acme/setup → //evil.invalid/setup.sh",
  });
  expect(check("[acme.dev](//docs.acme.dev/x.sh)")).toBeUndefined();
});

test("a relative target and an autolink are not compared", () => {
  expect(check("[github.com/acme](./docs/acme.md)")).toBeUndefined();
  expect(check("<https://evil.dev/x.sh>")).toBeUndefined();
});

test("a reference-style link compares its definition", () => {
  expect(check("[acme.dev][1]\n\n[1]: https://evil.dev\n")?.severity).toBe("warn");
});

test("a long password in the target is masked before the detail is shortened", () => {
  const password = "p".repeat(240);
  const detail = check(`[github.com/acme](https://user:${password}@evil.dev/install.sh)`)?.detail;
  expect(detail).toStartWith("github.com/acme → https://user:********@evil.dev/install.sh");
  expect(detail).not.toContain("pppp");
});
