import { entry, type Case } from "../test-fixture.ts";

export default [
  {
    name: "base64 decoded into sh",
    path: "scripts/run.sh",
    content: "#!/bin/sh\necho cGF5bG9hZA== | base64 -d | sh\n",
    fire: [{ severity: "critical", line: 2 }],
  },
  {
    name: "eval of a base64 decode",
    path: "SKILL.md",
    content: entry('eval "$(echo cGF5bG9hZA== | base64 --decode)"'),
    fire: [{ severity: "critical", line: 5 }],
  },
  {
    name: "base64 decoded into a file",
    path: "SKILL.md",
    content: entry("base64 -d cert.b64 > cert.pem"),
    silent: "none",
  },
  {
    name: "F8 a method named eval",
    path: "scripts/infer.py",
    content: "out = model.eval(base64_input)\n",
    silent: "critical",
    known: "F8, L33",
  },
  {
    name: "F8 a warning against eval",
    path: "SKILL.md",
    content: entry("Never eval base64 input from users."),
    silent: "info",
  },
] satisfies Case[];
