# niksi: skills CLI for coding agents

[![release](https://img.shields.io/github/v/release/osrim/niksi)](https://github.com/osrim/niksi/releases)
[![checks](https://github.com/osrim/niksi/actions/workflows/checks.yml/badge.svg)](https://github.com/osrim/niksi/actions/workflows/checks.yml)

`niksi` installs, updates, and links community skills into your coding agent. `add` and `update` scan every file before writing it and record what you installed in `niksi-lock.json`. `install` verifies that record, so your team runs the same reviewed skills.

The command is `nik`.

<img width="1200" height="642" alt="niksi-demo" src="https://github.com/user-attachments/assets/beac3a26-1c8a-479f-9e69-ee4e3409a6f2" />

## Features

- **Pick what you install**: `nik add owner/repo` lists the skills in a repository and lets you choose.
- **One install, every agent**: _Claude Code_, _Codex_, _Cursor_, _Gemini CLI_, _GitHub Copilot_, _OpenCode_, _Windsurf_, _Amp_, _Kiro_, _Cline_, _Qwen Code_, and every other agent that reads `.agents/skills`. Each skill is stored once and symlinked into every skills directory.
- **Reviewed updates**: `nik update` compares each installed skill with its source and shows the diff before it changes anything.
- **Dependencies**: skills that depend on other skills from the same source are detected, and `nik add` offers to add them too.
- **Security scan**: `add` and `update` scan every file before it is written. A critical finding stops the install until you approve it. See [Security scan](docs/security-scan.md).

## Install

[Homebrew](https://brew.sh), on macOS or Linux:

```sh
brew install osrim/tap/niksi
```

Or [npm](https://www.npmjs.com/package/niksi):

```sh
npm install -g niksi
```

Or run it without installing:

```sh
npx niksi add owner/repo
```

Or download the binary for your platform from the [latest release](https://github.com/osrim/niksi/releases/latest) and put it on your `PATH`. `niksi` needs `git`. For CI, see [Commands](docs/commands.md#ci).

## Quickstart

```sh
nik add mattpocock/skills   # pick skills, review them, write niksi-lock.json
nik install                 # restore every skill in niksi-lock.json on a fresh checkout
nik update                  # check upstream and review what changed
```

Commit `niksi-lock.json`. `nik install` checks each skill against the integrity recorded in `niksi-lock.json` before writing it, so teammates get the files you approved.

## Docs

- [Commands](docs/commands.md): every command, flag, and exit code, plus non-interactive use.
- [Configuration](docs/configuration.md): scope, agents, paths, environment variables, and the lockfile.
- [Security scan](docs/security-scan.md): what the scan catches and what it cannot.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
