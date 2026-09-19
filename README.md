# niksi: install, review, and share agent skills

[![release](https://img.shields.io/github/v/release/osrim/niksi)](https://github.com/osrim/niksi/releases)
[![checks](https://github.com/osrim/niksi/actions/workflows/checks.yml/badge.svg)](https://github.com/osrim/niksi/actions/workflows/checks.yml)

`nik` lets you install skills from Git repositories and keeps them up to date. Each skill is stored once and symlinked into your favourite agents: Claude Code, Codex, Cursor, Gemini CLI, GitHub Copilot, OpenCode, Windsurf, Amp, Kiro, Cline, Qwen Code, and any agent that reads `.agents/skills`.

> Niksi is the Finnish word for "trick"

<img width="1200" height="820" alt="nik add mattpocock/skills tdd: pick the scope and agents, review the scan, add a dependency" src="https://github.com/user-attachments/assets/be850703-f8fc-4776-92da-11b95161c623" />

## What you get

- **Install only what you need:** `nik add owner/repo` lists the skills in a repository. Pick the ones you want and which agents can use them.
- **Choose a scope:** install skills in a specific project or globally.
- **See what you are installing:** before anything is written, `nik` lists every file, scans the contents, and tells you if something looks harmful.
- **Keep skills up to date:** `nik update` fetches each source and shows you the diff. Approve it, or keep what you have.
- **Pin what should never change:** `nik add owner/repo@v1.2.0`. Everything else follows the latest stable tag, or the default branch.
- **Share skills with your team:** commit `niksi-lock.json`. It records the source, the commit, and a sha256 of the files. Your teammates get the exact files you reviewed by running `nik install`.
- **Pull in dependencies:** when a skill mentions another skill from the same source, `nik` offers to add it in the same run.
- **Use it in CI:** `nik install --yes` runs without a terminal and exits `0` only when every enabled skill is on disk with its recorded integrity.
- **No account, no registry, no telemetry.**

## Install

The binary name for niksi is `nik`.

Try it without installing:

```sh
npx niksi add owner/repo
```

Install with npm:

```sh
npm install -g niksi
```

Or with Homebrew, on macOS or Linux:

```sh
brew install osrim/tap/niksi
```

Or download a binary from the [latest release](https://github.com/osrim/niksi/releases/latest) and put it on your `PATH`.

### Requirements

- macOS or Linux. There is no Windows build yet.
- `git` on your `PATH`.

## Quick start

Add one skill from a repository:

```sh
nik add mattpocock/skills tdd
```

The skill mentions another skill in the same source, so `nik` offers to install that one as well. Both are now recorded in `niksi-lock.json`:

```console
$ nik list -g
◇  Installed skills (~/.config/niksi/niksi-lock.json)
│
│  mattpocock/skills
│    codebase-design  v1.2.3  universal, claude, kiro
│    tdd              v1.2.3  universal, claude, kiro
│
└  2 skill(s) installed (global).
```

Later, check the source for changes. `nik` fetches, compares, and shows you the diff. Approve it or leave things as they are:

```sh
nik update
```

Working on a team? Install skills in your projects and commit `niksi-lock.json`. Your teammates get the same skills with one command:

```sh
nik install
```

`install` checks every file against the sha256 in the lockfile.

## Commands

| command                         | what it does                                                           |
| ------------------------------- | ---------------------------------------------------------------------- |
| `nik add <coordinate> [skills]` | Fetch a source, pick skills, review and scan them, write the lockfile. |
| `nik install`                   | Restore every enabled skill in `niksi-lock.json`.                      |
| `nik update [skills]`           | Compare installed skills with upstream and review the diff.            |
| `nik remove [skills]`           | Remove installed skills and their lockfile entries.                    |
| `nik list`                      | Show installed skills. `--json` for scripts.                           |
| `nik disable`, `nik enable`     | Disable and enable recorded skills. No new review.                     |
| `nik prune`                     | Delete unrecorded store entries.                                       |

A coordinate is `owner/repo`, `owner/repo/path/to/skill`, `owner/repo@v1.2.0` to pin a ref, a forge URL, a Git URL, or a local directory. See [docs/commands.md](docs/commands.md) for more information.

## The scan

`add` and `update` scan each file before writing it. The rules catch `curl` piped to a shell, known exfiltration hosts, hooks in `SKILL.md` frontmatter, commands that run at load time, invisible Unicode, and reads of `~/.ssh` and `~/.aws`. Findings are `info`, `warn`, or `critical`. A critical finding stops the install until you approve it in a terminal.

> [!IMPORTANT]
> `niksi` runs static checks. It does not run the skill, follow URLs, or understand intent. **A malicious skill can pass clean and a good one can have false positives.** Read more in [docs/security-scan.md](docs/security-scan.md).

## What niksi does not do

- No registry, catalogue, or search.
- No skill authoring or evaluation.
- No sync of MCP servers, rules, or hooks.
- No telemetry.

## Compared with other installers

Checked against each tool's documentation on 2026-09-19.

|                          | niksi                                     | `npx skills`                        | `gh skill`                               |
| ------------------------ | ----------------------------------------- | ----------------------------------- | ---------------------------------------- |
| lockfile                 | `niksi-lock.json` in the project          | in the home directory               | none, provenance in SKILL.md frontmatter |
| content integrity        | sha256 of the files, checked on `install` | tree SHA, for update detection      | tree SHA, for update detection           |
| pre-install scan         | local, offline, gates the write           | third-party web audits on skills.sh | none                                     |
| restore from lockfile    | `nik install`                             | none                                | none                                     |
| telemetry                | none                                      | on by default                       | none                                     |
| search                   | none                                      | `find`                              | `search`                                 |

## Docs

- [Commands](docs/commands.md): every command, flag, and exit code, plus non-interactive use.
- [Configuration](docs/configuration.md): scope, agents, paths, environment variables, and the lockfile.
- [Security scan](docs/security-scan.md): what the scan catches and what it cannot.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Bug reports from Linux and from agents other than Claude Code help most right now.

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/osrim/niksi/security/advisories/new), not a public issue. Details in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
