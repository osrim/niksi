import { expect, test } from "bun:test";
import { destructive } from "./destructive.ts";
import { shellStatements } from "./shell.ts";

const noProseContext = { afterProhibition: () => false, demoted: () => false };

const inScript = (...lines: string[]) => {
  const text = lines.join("\n");
  return destructive(text, shellStatements(text, false), noProseContext);
};

const inMarkdown = (text: string) => destructive(text, shellStatements(text, true), noProseContext);

const severity = (...lines: string[]) => inScript(...lines)?.severity;

test("rm -r keeps its targets and sudo rules", () => {
  expect(inScript("sudo rm -rf /usr/local/*")).toEqual({
    severity: "critical",
    line: 1,
    detail: "sudo rm -rf /usr/local/*",
  });
  expect(severity("rm -rf node_modules")).toBe("info");
  expect(severity("rm -f build.log")).toBeUndefined();
});

test("disk writes, filesystem creation, and fork bombs are critical", () => {
  expect(severity("dd if=/dev/zero of=/dev/sda")).toBe("critical");
  expect(severity("mkfs.ext4 /dev/sda1")).toBe("critical");
  expect(severity("mkfs -t ext4 /dev/sdb1")).toBe("critical");
  expect(severity(":(){ :|:& };:")).toBe("critical");
  expect(severity("dd if=/dev/sda of=/dev/null bs=1M")).toBeUndefined();
  expect(severity("dd if=/dev/zero of=disk.img bs=1M count=8")).toBeUndefined();
  expect(severity("mkfs --help")).toBeUndefined();
});

test("sudo or doas before rm, dd, mkfs, or chown is critical", () => {
  expect(severity("sudo chown -R root /opt/app")).toBe("critical");
  expect(severity("doas rm /etc/motd")).toBe("critical");
  expect(severity("sudo apt-get install jq")).toBeUndefined();
});

test("sudo chmod that loosens a mode, or sudo on an account file, stays critical", () => {
  expect(severity("sudo chmod 777 /etc/shadow")).toBe("critical");
  expect(severity("sudo chmod u+s /usr/local/bin/tool")).toBe("critical");
  expect(severity("echo bad | sudo tee /etc/sudoers")).toBe("critical");
  expect(severity("echo bad | doas tee -a /etc/sudoers.d/extra")).toBe("critical");
});

test("sudo or doas before chmod or tee warns", () => {
  expect(severity("sudo chmod +x /usr/local/bin/tool")).toBe("warn");
  expect(severity("doas chmod 755 /usr/local/bin/tool")).toBe("warn");
  expect(severity("echo deb x | sudo tee /etc/apt/sources.list.d/x.list")).toBe("warn");
});

test("history rewrites, history wipes, and loose permissions are warn", () => {
  expect(severity("git reset --hard origin/main")).toBe("warn");
  expect(severity("git push --force origin main")).toBe("warn");
  expect(severity("git push -f")).toBe("warn");
  expect(severity("git clean -fdx")).toBe("warn");
  expect(severity("chmod 777 /srv/share")).toBe("warn");
  expect(severity("chmod -R 0777 build")).toBe("warn");
  expect(severity("chmod u+s /usr/local/bin/tool")).toBe("warn");
  expect(severity("chmod 4755 tool")).toBe("warn");
  expect(severity("chmod u+x,g+s tool")).toBe("warn");
  expect(severity("history -c")).toBe("warn");
  expect(severity("rm ~/.bash_history")).toBe("warn");
  expect(severity("git push --force-with-lease")).toBeUndefined();
  expect(severity("git clean -n")).toBeUndefined();
  expect(severity("chmod 755 tool")).toBeUndefined();
  expect(severity("history | tail")).toBeUndefined();
});

test("prose needs an operand that looks like a path", () => {
  expect(inMarkdown("The mkfs command formats a disk.")).toBeUndefined();
  expect(inMarkdown("Format it with mkfs.ext4 /dev/sdb1 first.")?.severity).toBe("critical");
  expect(inMarkdown("Then run git reset --hard to start over.")?.severity).toBe("warn");
  expect(inMarkdown("Run `chmod 777 /srv/share` first.")?.severity).toBe("warn");
  expect(inMarkdown("Run `chmod -R 4755 tool` first.")?.severity).toBe("warn");
});

test("one line counts once, and a comment drops one level", () => {
  expect(inScript("sudo rm -rf /", "git reset --hard")?.detail).toBe("sudo rm -rf / (2 matches)");
  expect(severity("# dd if=/dev/zero of=/dev/sda")).toBe("warn");
});
