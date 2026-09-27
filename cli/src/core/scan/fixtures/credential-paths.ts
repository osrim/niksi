import { entry, type Case } from "../test-fixture.ts";

export default [
  {
    name: "reads a private SSH key",
    path: "SKILL.md",
    content: entry("cat ~/.ssh/id_ed25519"),
    fire: [{ severity: "critical", line: 5 }],
  },
  {
    name: "reads AWS credentials",
    path: "scripts/collect.sh",
    content: "#!/bin/sh\ncat ~/.aws/credentials\n",
    fire: [{ severity: "critical", line: 2 }],
  },
  {
    name: "an ssh command",
    path: "SKILL.md",
    content: entry("ssh deploy@build.example.com uptime"),
    silent: "none",
  },
  {
    name: "P4 the home directory as $HOME",
    path: "SKILL.md",
    content: entry("cat $HOME/.ssh/id_ed25519"),
    silent: "none",
    known: "P4, L18",
  },
  {
    name: "F6 a public key",
    path: "SKILL.md",
    content: entry("Add your public key from ~/.ssh/id_rsa.pub to the server."),
    silent: "critical",
    known: "F6, L18",
  },
  {
    name: "F6 key generation",
    path: "SKILL.md",
    content: entry("ssh-keygen -t rsa -f ~/.ssh/id_rsa"),
    silent: "critical",
    known: "F6, L18",
  },
] satisfies Case[];
