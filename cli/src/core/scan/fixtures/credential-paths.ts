import { entry, type Case } from "../test-fixture.ts";

export default [
  {
    name: "reads a private SSH key",
    path: "SKILL.md",
    content: entry("cat ~/.ssh/id_ed25519"),
    fire: [{ severity: "critical", line: 5, detail: "~/.ssh/id_ed25519" }],
  },
  {
    name: "P4 reads a private SSH key through $HOME",
    path: "SKILL.md",
    content: entry("cat $HOME/.ssh/id_ed25519"),
    fire: [{ severity: "critical", line: 5, detail: "~/.ssh/id_ed25519" }],
  },
  {
    name: "reads AWS credentials in a script",
    path: "scripts/collect.sh",
    content: "#!/bin/sh\ncat ~/.aws/credentials\n",
    fire: [{ severity: "critical", line: 2 }],
  },
  {
    name: "archives the GnuPG directory from /Users/<name>",
    path: "scripts/pack.sh",
    content: "#!/bin/sh\ntar czf /tmp/k.tgz /Users/ada/.gnupg\n",
    fire: [{ severity: "critical", line: 2, detail: "~/.gnupg" }],
  },
  {
    name: "a kube config path in a Python script",
    path: "scripts/kube.py",
    content: 'import os\npath = os.path.expanduser("~/.kube/config")\n',
    fire: [{ severity: "critical", line: 2, detail: "~/.kube/config" }],
  },
  {
    name: "reads /etc/shadow",
    path: "SKILL.md",
    content: entry("Run `sudo cat /etc/shadow` to check."),
    fire: [{ severity: "critical", line: 5, detail: "/etc/shadow" }],
  },
  {
    name: "dumps the macOS keychain in a fence",
    path: "SKILL.md",
    content: entry("```sh", "security dump-keychain -d login.keychain", "```"),
    fire: [{ severity: "critical", line: 6, detail: "security dump-keychain" }],
  },
  {
    name: "copies a browser login file",
    path: "scripts/grab.sh",
    content:
      '#!/bin/sh\ncp "$HOME/Library/Application Support/Google/Chrome/Default/Login Data" /tmp/\n',
    fire: [{ severity: "critical", line: 2, detail: "Login Data" }],
  },
  {
    name: "a credential file named in prose",
    path: "SKILL.md",
    content: entry("The CLI keeps your token in ~/.npmrc after login."),
    fire: [{ severity: "warn", line: 5, detail: "~/.npmrc" }],
  },
  {
    name: "F6 a public key",
    path: "SKILL.md",
    content: entry("Add your public key from ~/.ssh/id_rsa.pub to the server."),
    fire: [{ severity: "warn", line: 5, detail: "~/.ssh/id_rsa.pub" }],
  },
  {
    name: "a nested public key read in a setup script",
    path: "scripts/setup.sh",
    content: "#!/bin/sh\ncat ~/.ssh/keys/id_ed25519.pub\n",
    fire: [{ severity: "warn", line: 2, detail: "~/.ssh/keys/id_ed25519.pub" }],
  },
  {
    name: "a nested private key read in a script",
    path: "scripts/grab.sh",
    content: "#!/bin/sh\ncat ~/.ssh/keys/id_ed25519\n",
    fire: [{ severity: "critical", line: 2, detail: "~/.ssh/keys/id_ed25519" }],
  },
  {
    name: "F6 key generation",
    path: "SKILL.md",
    content: entry("```sh", "ssh-keygen -t rsa -f ~/.ssh/id_rsa", "```"),
    fire: [{ severity: "warn", line: 6, detail: "~/.ssh/id_rsa" }],
  },
  {
    name: "an ssh command",
    path: "SKILL.md",
    content: entry("ssh deploy@build.example.com uptime"),
    silent: "none",
  },
  {
    name: "setup commands on the ssh directory",
    path: "SKILL.md",
    content: entry("```sh", "mkdir -p ~/.ssh", "cd ~/.ssh", "chmod 600 ~/.ssh/id_ed25519", "```"),
    silent: "warn",
  },
  {
    name: "a read in a prohibition",
    path: "SKILL.md",
    content: entry("Never run `cat ~/.aws/credentials` in a shared terminal."),
    silent: "info",
  },
  {
    name: "a cookie guide URL",
    path: "scripts/docs.sh",
    content: "#!/bin/sh\ncurl https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies\n",
    silent: "none",
  },
  {
    name: "cookies in prose",
    path: "SKILL.md",
    content: entry("Cookies and Login Data stay in the browser."),
    silent: "none",
  },
] satisfies Case[];
