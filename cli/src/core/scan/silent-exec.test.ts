import { expect, test } from "bun:test";
import { shellStatements } from "./shell.ts";
import { silentExec } from "./silent-exec.ts";

const noProseContext = { afterProhibition: () => false, demoted: () => false };

const scan = (lines: string[], escalated = false) => {
  const text = lines.join("\n");
  return silentExec(text, shellStatements(text, false), noProseContext, () => escalated);
};

const severity = (...lines: string[]) => scan(lines)?.severity;

const options = (count: number) => Array.from({ length: count }, (_, i) => `  opt${i}: ${i},`);

test("a detached or silenced background process is warn", () => {
  expect(scan(["nohup python3 /tmp/helper.py > /dev/null 2>&1 &"])).toEqual({
    severity: "warn",
    line: 1,
    detail: "nohup python3 /tmp/helper.py > /dev/null 2>&1 &",
  });
  expect(severity("setsid ./worker")).toBe("warn");
  expect(severity("./worker & disown")).toBe("warn");
  expect(severity("./worker &>/dev/null &")).toBe("warn");
  expect(severity("./worker >/dev/null 2>/dev/null &")).toBe("warn");
});

test("output to /dev/null needs both streams and a background job", () => {
  expect(severity("npm test 2>/dev/null || true")).toBeUndefined();
  expect(severity("./worker > /dev/null 2>&1")).toBeUndefined();
  expect(severity("./worker 2>&1 > /dev/null &")).toBeUndefined();
  expect(severity("./worker > out.log 2>&1 &")).toBeUndefined();
  expect(severity("nohup")).toBeUndefined();
});

test("Python and JavaScript detach or silence a child", () => {
  expect(severity("subprocess.Popen(cmd, start_new_session=True)")).toBe("warn");
  expect(
    severity("subprocess.Popen(cmd,", "  stdout=subprocess.DEVNULL,", "  stderr=DEVNULL)"),
  ).toBe("warn");
  expect(severity("subprocess.run(cmd, stdout=subprocess.DEVNULL)")).toBeUndefined();
  expect(severity("spawn(cmd, args, {", "  detached: true,", "  stdio: 'ignore',", "});")).toBe(
    "warn",
  );
  expect(severity("const child = spawn(cmd, args);", "child.unref();")).toBe("warn");
  expect(severity("const child = spawn(cmd, args, {", ...options(6), "});", "child.unref();")).toBe(
    "warn",
  );
  expect(
    severity("const child = spawn(cmd, args, {", ...options(20), "});", "child.unref();"),
  ).toBeUndefined();
  expect(severity("setTimeout(tick, 1000).unref();")).toBeUndefined();
  expect(severity("spawn(cmd, args, { detached: true });")).toBeUndefined();
});

test("a download, decode, or persistence match anywhere in the file makes it critical", () => {
  expect(scan(["nohup ./worker &"], true)?.severity).toBe("critical");
});

test("a comment drops one level", () => {
  expect(scan(["# nohup ./worker &"], true)?.severity).toBe("warn");
});
