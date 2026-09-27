import type { Case } from "../test-fixture.ts";

export default [
  {
    name: "a plugin manifest",
    path: ".claude-plugin/plugin.json",
    content: "{}\n",
    fire: [{ severity: "critical" }],
  },
  { name: "an MCP config", path: ".mcp.json", content: "{}\n", fire: [{ severity: "critical" }] },
  { name: "a hooks file", path: "hooks.json", content: "{}\n", fire: [{ severity: "critical" }] },
  {
    name: "an agent settings file",
    path: "config/settings.json",
    content: "{}\n",
    fire: [{ severity: "critical" }],
  },
  {
    name: "an OpenCode config",
    path: "opencode.jsonc",
    content: "{}\n",
    fire: [{ severity: "critical" }],
  },
  { name: "docs about plugins", path: "docs/plugin.md", content: "Plugins.\n", silent: "none" },
  { name: "a YAML settings file", path: "config/settings.yaml", content: "a: 1\n", silent: "none" },
] satisfies Case[];
