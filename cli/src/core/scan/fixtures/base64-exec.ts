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
    name: "Python exec of b64decode",
    path: "scripts/run.py",
    content: 'import base64\nexec(base64.b64decode("aW1wb3J0IG9z"))\n',
    fire: [{ severity: "critical", line: 2, detail: "exec(base64.b64decode" }],
  },
  {
    name: "JavaScript eval of a decoded Buffer",
    path: "scripts/run.js",
    content: 'eval(Buffer.from(payload, "base64").toString());\n',
    fire: [{ severity: "critical", line: 1 }],
  },
  {
    name: "eval of atob",
    path: "scripts/run.js",
    content: "const out = eval(atob(blob));\n",
    fire: [{ severity: "critical", line: 1 }],
  },
  {
    name: "PHP eval of base64_decode",
    path: "scripts/shell.php",
    content: "<?php eval(base64_decode($_POST['x'])); ?>\n",
    fire: [{ severity: "critical", line: 1 }],
  },
  {
    name: "base64 decoded into a file",
    path: "SKILL.md",
    content: entry("base64 -d cert.b64 > cert.pem"),
    silent: "none",
  },
  {
    name: "a decode with no sink",
    path: "scripts/read.py",
    content: "data = base64.b64decode(blob)\n",
    silent: "none",
  },
  {
    name: "F8 a method named eval",
    path: "scripts/infer.py",
    content: "out = model.eval(base64_input)\n",
    silent: "none",
  },
  {
    name: "F8 a method named eval beside a decode",
    path: "scripts/infer.py",
    content: "out = model.eval(base64.b64decode(blob))\n",
    silent: "none",
  },
  {
    name: "F8 a warning against eval",
    path: "SKILL.md",
    content: entry("Never eval base64 input from users."),
    silent: "none",
  },
] satisfies Case[];
