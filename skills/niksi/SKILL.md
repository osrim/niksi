---
name: niksi
description: Install, update, and inspect agent skills with nik, which scans every file before it writes. Use when asked to install, update, or list skills.
---

Your shell has no terminal, so `nik` asks nothing: every answer is a flag, and every scan finding is the user's to decide.

## Setup

1. Run `nik --version`. If it is missing, ask the user whether to install it (`npm install -g niksi` or `brew install osrim/tap/niksi`) or to run `npx niksi` with the same arguments.
2. Pass a scope to every command: `-p` (this project, recorded in its `niksi-lock.json`), or `-g` when the user wants every project. The commands below show `-p`.

## Install

A coordinate is `owner/repo`, `owner/repo/skill`, `owner/repo@v1.2.0`, a repository URL, or a local directory. Skill names follow it, or `--all` takes every skill.

1. Preview run: `nik add <coordinate> <skill>... -p`. Without `--yes`, `nik` lists and scans the files, writes nothing, and exits `2` with `needs confirmation, and there is no terminal to ask`. Act on these lines:
   - `needs to know which skills`: ask the user which, or pass `--all`.
   - `Linking to <ids>.`: the skills directories it will fill. Your id is `claude` for Claude Code, and `universal` for Codex, Gemini CLI, and most others ([agents table](https://raw.githubusercontent.com/osrim/niksi/main/docs/configuration.md)). If yours is missing, pass `--agent` with the listed ids plus yours, such as `--agent universal,claude`.
   - `is outside this project`: ask the user for `--copy` (files go into the project) or `-g`, then preview again.

   `nik` saves `-p`, `-g`, and `--agent` for later runs, even from a preview run. Tell the user when you change them.
2. Triage the findings.
3. Rerun with `--yes`, naming only the approved skills. Done when it exits `0`.
4. Read `nik list -p --json`: the skill is installed (see Installed state) and its `agents` holds your id. Report the name, source, label (from `installed @ <label>`), agents, and every finding.

When `nik add` prints another `nik add` command for a skill the new one mentions, offer it to the user as a new install.

## Update

1. Preview run: `nik update <skill>... -p` with the skills the user named, or `nik update --all -p` when they want everything. It shows each update's diff stat and scan, then exits `2`. Exit `0` with no scan means nothing is due.
2. Triage the findings.
3. Rerun with `--yes`, naming only the approved skills. Done when it exits `0`.

- `--all` holds back a revision younger than the cooldown (3 days, or `minimumReleaseAge` in `niksi.json`) and prints `waits for cooldown`. Naming the skill takes it, so name it only at the user's request.
- A skill with `track: pin` updates only when named.
- Updating a `modified` skill replaces the user's edits. Ask first.

## Triage

Act on each skill's worst finding. Read the findings, not the exit code: a run where only some skills are blocked still exits `2`.

- None, or `info`: go on.
- `warn`: show the user each finding (rule, file and line, detail). Go on only on a yes; `--yes` accepts it.
- `critical`, or `warn` when `niksi.json` sets `policy.denyWarn`: `nik` skips the skill with `review ... findings in a terminal.`, and exits `3` when every skill is blocked. Show the user the findings and give them the same command to run in their own terminal, where they decide. That decision is theirs alone: leave `--dangerous-skip-critical-approval` out of every command you run.

## Installed state

`nik list -p --json` (or `-g`) prints `{ "scope", "lockfile", "skills": [...] }`. Read it, not the table. Each skill carries its lockfile fields (`source`, `path`, `commit`, `tag`, `track`, and more; see [entry fields](https://raw.githubusercontent.com/osrim/niksi/main/docs/lockfile.md)), plus `agents` and `links` for what is on disk now, and `modified`. Each skill is in one state:

- Installed: `agents` is not empty. For a `copyPath` entry, `agents` and `links` are always empty, so check that `<copyPath>/<name>` exists.
- Missing: `agents` is empty, with no `disabled` or `copyPath`. `nik install -p` restores it.
- Disabled (`disabled: true`): `nik enable <name> -p` restores it.
- Modified (`modified: true`): the files differ from what was reviewed. `nik install -p --yes` restores every modified skill in the scope and drops all their edits, so list them all and ask first.

## Exit codes

- `0`: done.
- `1`: a skill failed and the rest ran. Read the message.
- `2`: a preview run reached the confirmation, or `nik` needs a flag or a fix that the message names.
- `3`: the user must decide (see Triage), or in `update`, `niksi.json` doesn't allow a skill's source.

Every command and flag: [commands.md](https://raw.githubusercontent.com/osrim/niksi/main/docs/commands.md).
