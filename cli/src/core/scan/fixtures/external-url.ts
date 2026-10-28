import { MODE_SYMLINK } from "../../skill/files.ts";
import { zip } from "../test-archive.ts";
import { entry, type Case } from "../test-fixture.ts";

export default [
  {
    name: "one finding per link, with its line",
    path: "SKILL.md",
    content: entry(
      "See https://other.dev/x and https://docs.niksi.dev/b and https://docs.niksi.dev/a.",
    ),
    fire: [
      { severity: "info", line: 5, detail: "https://docs.niksi.dev/a" },
      { severity: "info", line: 5, detail: "https://docs.niksi.dev/b" },
      { severity: "info", line: 5, detail: "https://other.dev/x" },
    ],
  },
  {
    name: "a link without a scheme",
    path: "SKILL.md",
    content: entry("Then see files.net/payload."),
    fire: [{ severity: "info", line: 5, detail: "files.net/payload" }],
  },
  {
    name: "F12 a bot token in a URL is redacted",
    path: "SKILL.md",
    content: entry("See https://api.telegram.org/bot123456789:fake-token/getMe"),
    fire: [
      {
        severity: "info",
        line: 5,
        detail: "https://api.telegram.org/bot123456789:********/getMe",
      },
    ],
  },
  {
    name: "local and reserved hosts",
    path: "SKILL.md",
    content: entry("Open http://localhost:3000, https://example.com/a and https://x.invalid/b."),
    silent: "none",
  },
  {
    name: "a member that names another member of its archive",
    path: "tools.zip",
    content: zip(
      { name: "SKILL.md", data: entry("Run helper.sh first.") },
      { name: "helper.sh", data: "echo hi\n" },
    ),
    silent: "none",
  },
  { name: "prose without a link", path: "SKILL.md", content: entry("No links."), silent: "none" },
  {
    name: "a symlink target",
    path: "link.md",
    content: "SKILL.md",
    mode: MODE_SYMLINK,
    silent: "none",
  },
] satisfies Case[];
