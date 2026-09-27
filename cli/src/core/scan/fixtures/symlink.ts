import { MODE_SYMLINK } from "../../skill/files.ts";
import type { Case } from "../test-fixture.ts";

export default [
  {
    name: "a link inside the skill",
    path: "link",
    content: "./sibling.md",
    mode: MODE_SYMLINK,
    fire: [{ severity: "warn" }],
  },
  {
    name: "a link that climbs out",
    path: "link",
    content: "../../outside",
    mode: MODE_SYMLINK,
    fire: [{ severity: "critical" }],
  },
  {
    name: "an absolute link",
    path: "nested/link",
    content: "/etc/passwd",
    mode: MODE_SYMLINK,
    fire: [{ severity: "critical" }],
  },
  { name: "a file that names another", path: "link.md", content: "SKILL.md", silent: "none" },
] satisfies Case[];
