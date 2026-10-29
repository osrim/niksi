import { entry, type Case } from "../test-fixture.ts";
import { BEARER, DB_PASSWORD } from "../test-secrets.ts";

export default [
  {
    name: "a database URL with a password",
    path: "SKILL.md",
    content: entry(`psql postgres://app:${DB_PASSWORD}@db.internal:5432/app`),
    fire: [{ severity: "warn", line: 5, detail: "postgres://app:********@db.internal" }],
  },
  {
    name: "a bearer token in a curl header",
    path: "scripts/call.sh",
    content: `#!/bin/sh\ncurl -H "Authorization: Bearer ${BEARER}" https://api.dev/v1\n`,
    fire: [{ severity: "warn", line: 2, detail: "Authorization: Bearer ********" }],
  },
  {
    name: "an API key header",
    path: "scripts/call.sh",
    content: `#!/bin/sh\ncurl --header 'X-Api-Key: ${BEARER}' https://api.dev/v1\n`,
    fire: [{ severity: "warn", line: 2, detail: "X-Api-Key: ********" }],
  },
  {
    name: "a placeholder password on localhost",
    path: "SKILL.md",
    content: entry("DATABASE_URL=postgres://user:password@localhost/db"),
    fire: [{ severity: "info", line: 5, detail: "postgres://user:********@localhost" }],
  },
  {
    name: "a placeholder password on a real host",
    path: "SKILL.md",
    content: entry("redis://default:changeme@cache.dev:6379"),
    fire: [{ severity: "info", line: 5 }],
  },
  {
    name: "a real-looking password on an example host",
    path: "SKILL.md",
    content: entry(`https://admin:${DB_PASSWORD}@api.example.com/`),
    fire: [{ severity: "info", line: 5 }],
  },
  {
    name: "a filler word as a bearer token",
    path: "reference/evaluation.md",
    content: '```sh\ncurl -H "Authorization: Bearer token123" \\\n  https://api.dev\n```\n',
    fire: [{ severity: "info", line: 2, detail: "Authorization: Bearer ********" }],
  },
  {
    name: "a bearer token from a variable",
    path: "SKILL.md",
    content: entry('curl -H "Authorization: Bearer $TOKEN" https://api.example.com'),
    silent: "none",
  },
  {
    name: "a bearer token from an Actions secret",
    path: "SKILL.md",
    content: entry('curl -H "Authorization: Bearer ${{ secrets.TOKEN }}" https://api.dev'),
    silent: "none",
  },
  {
    name: "a user with no password",
    path: "SKILL.md",
    content: entry("git clone https://deploy@git.dev/team/repo.git"),
    silent: "none",
  },
  {
    name: "a short header value",
    path: "SKILL.md",
    content: entry("curl -H 'X-Api-Key: abc' https://api.dev"),
    silent: "none",
  },
] satisfies Case[];
