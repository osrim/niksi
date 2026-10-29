import { expect, test } from "bun:test";
import { dependencySource } from "./dependency-source.ts";
import { shellStatements } from "./shell.ts";

const noProseContext = { afterProhibition: () => false, demoted: () => false };

const inScript = (...lines: string[]) =>
  dependencySource(shellStatements(lines.join("\n"), false), noProseContext);

const severity = (line: string) => inScript(line)?.severity;

test("the strongest match is reported with the match count", () => {
  expect(inScript("curl -k https://x.invalid/a", "npm set registry=https://npm.x.invalid")).toEqual(
    { severity: "critical", line: 2, detail: "npm set registry=https://npm.x.invalid (2 matches)" },
  );
});

test("an index is critical off its default host or over plain HTTP", () => {
  expect(severity("pip install -ihttps://pkgs.x.invalid/simple foo")).toBe("critical");
  expect(severity("pip install --index-url http://pypi.org/simple foo")).toBe("critical");
  expect(severity("pip install --index-url https://pypi.org.x.invalid/simple foo")).toBe(
    "critical",
  );
  expect(severity("pip install --index-url https://files.pythonhosted.org/x foo")).toBeUndefined();
  expect(severity("yarn add --registry https://registry.yarnpkg.com left-pad")).toBeUndefined();
  expect(severity("npm install --registry https://pypi.org left-pad")).toBe("critical");
});

test("an index that is not a URL is warn", () => {
  expect(severity('pip install --index-url "$INDEX" foo')).toBe("warn");
  expect(severity("pip install --index-url file:///srv/wheels foo")).toBe("warn");
});

test("registry config writes cover scopes, yarn, and pip", () => {
  expect(severity("npm config set @org:registry https://npm.x.invalid")).toBe("critical");
  expect(severity("yarn config set npmRegistryServer https://npm.x.invalid")).toBe("critical");
  expect(severity("pip config set global.index-url https://pkgs.x.invalid/simple")).toBe(
    "critical",
  );
  expect(severity("npm config get registry")).toBeUndefined();
  expect(severity("npm config set fund false")).toBeUndefined();
});

test("index variables are read in shell, PowerShell, and Dockerfile forms", () => {
  expect(severity('$env:PIP_INDEX_URL = "https://pkgs.x.invalid/simple"')).toBe("critical");
  expect(severity("ENV UV_INDEX_URL=https://pkgs.x.invalid/simple")).toBe("critical");
  expect(severity("export PIP_EXTRA_INDEX_URL=https://pypi.org/simple")).toBeUndefined();
});

test("an install pinned to a commit is info, and a moving git ref is warn", () => {
  const commit = "0123456789abcdef0123456789abcdef01234567";
  expect(severity(`npm install github:org/tool#${commit}`)).toBe("info");
  expect(severity("npm install github:org/tool#main")).toBe("warn");
  expect(severity("pip install -e git+https://github.com/org/repo@v1.0#egg=repo")).toBe("warn");
});

test("an index flag value is not read as a URL install", () => {
  expect(severity("pip install --index-url https://pypi.org/simple foo")).toBeUndefined();
  expect(severity("npm install --registry https://registry.npmjs.org left-pad")).toBeUndefined();
});

test("bundled package.json dependencies from a URL or git are warn", () => {
  const manifest = JSON.stringify(
    { dependencies: { a: "^1.0.0" }, devDependencies: { b: "git+ssh://git@x.invalid/b.git" } },
    null,
    2,
  );
  expect(dependencySource([], noProseContext, manifest)).toEqual({
    severity: "warn",
    line: 6,
    detail: "devDependencies b: git+ssh://git@x.invalid/b.git",
  });
  expect(dependencySource([], noProseContext, "{")).toBeUndefined();
});

test("flags before the subcommand and config flags with values are read", () => {
  expect(severity("npm --registry https://npm.x.invalid install foo")).toBe("critical");
  expect(severity("npm -g i foo --registry https://npm.x.invalid")).toBe("critical");
  expect(severity("pip -q install --index-url https://pkgs.x.invalid/simple foo")).toBe("critical");
  expect(severity("npm config --global set registry https://npm.x.invalid")).toBe("critical");
  expect(severity("npm config set --location global registry https://npm.x.invalid")).toBe(
    "critical",
  );
  expect(severity("npm publish --registry https://npm.x.invalid")).toBeUndefined();
});

test("a pin is a commit as the Git ref or the archive name, not any 40 hex characters", () => {
  const commit = "0123456789abcdef0123456789abcdef01234567";
  expect(severity(`pip install git+https://x.invalid/repo@${commit}#egg=repo`)).toBe("info");
  expect(severity(`npm install https://github.com/org/tool/archive/${commit}.tar.gz`)).toBe("info");
  expect(severity(`pip install git+https://x.invalid/repo@main#sha=${commit}`)).toBe("warn");
  expect(severity(`npm install https://x.invalid/${commit}/tool.tgz`)).toBe("warn");
});

test("a requirements file from a URL is warn", () => {
  expect(severity("pip install -r https://x.invalid/requirements.txt")).toBe("warn");
  expect(severity("pip install -r requirements.txt")).toBeUndefined();
});
