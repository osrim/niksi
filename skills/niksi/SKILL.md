---
name: niksi
description: Install, update, and inspect agent skills with nik, which scans every file before it writes. Use when asked to install or add a skill, update skills, or check which skills are installed.
---

`nik` installs skills from Git repositories and local directories. It lists
and scans every file before it writes, and records each skill in
`niksi-lock.json`. Your shell has no terminal, so `nik` cannot ask questions:
every answer is a flag, and the user decides what to do about findings.

## Before you start

1. Run `nik --version`. If `nik` is not found, ask the user whether to install
   it (`npm install -g niksi` or `brew install osrim/tap/niksi`) or to run it
   once through `npx niksi`, which takes the same arguments.
2. Choose the scope and pass it to every command. `-p` (project) installs for
   this repository and records the skill in its `niksi-lock.json`, so
   teammates get it with `nik install`. `-g` (global) installs for every
   project on this machine. Use `-p` unless the user asks for all projects.
   The commands below show `-p`: use the scope you chose.

## Install a skill

A coordinate names the source: `owner/repo` (GitHub), `owner/repo/skill-name`,
`owner/repo@v1.2.0` to pin a ref, a repository URL, or a local directory.
Skill names follow the coordinate. `--all` selects every skill in the source.

1. Make a preview run: `nik add <coordinate> <skill> -p`. Without `--yes`,
   `nik` fetches the skill, lists its files, scans them, prints the findings,
   writes nothing, and exits `2` with `needs confirmation, and there is no
   terminal to ask`. That exit ends a good preview.
   - `needs to know which skills`: the source has several. Ask the user which
     ones, or use `--all` when they want every skill.
   - `Linking to <ids>.` names the skills directories `nik` will use. Your
     own agent's id is `claude` for Claude Code, and `universal` for Codex,
     Gemini CLI, and most other agents. The Agents section of
     https://raw.githubusercontent.com/osrim/niksi/main/docs/configuration.md
     maps each agent to its ids. If yours is missing, add `--agent` with the
     listed ids plus yours, such as `--agent universal,claude`.
   - `nik` saves `-p`, `-g`, and `--agent` as the user's choices for later
     runs, even in a preview run. Tell the user when you change them.
   - `is outside this project`: a local directory outside the project would
     record a path that other machines cannot resolve, and the preview stops
     before the scan. Ask the user to choose `--copy`, which puts the files in
     the project, or `-g`, then make the preview run again with it.
2. Act on the worst finding of each skill:
   - No findings, or only `info`: go to step 3.
   - `warn`: show the user each finding (rule, file and line, detail) and ask
     whether to install. Go on only when they say yes.
   - `critical`: `nik` prints `<skill>: review critical findings in a
     terminal.` and skips that skill. The run exits `3` when every selected
     skill is blocked, else `2` at the confirmation for the rest, so read
     each skill's findings rather than the exit code. Show the user the
     findings, and give them the same `nik add` command to run in their own
     terminal, where `nik` shows the files and asks them to decide. Critical
     approval belongs to the user in that terminal, so leave
     `--dangerous-skip-critical-approval` out of every command you run.
   - When the project's `niksi.json` sets `policy.denyWarn`, a `warn` finding
     blocks like a `critical` one, and `--yes` doesn't accept it. Handle it
     as `critical`.
3. Rerun the preview command with `--yes`, naming only the skills the user
   approved. `--yes` accepts their `warn` findings. Done when it exits `0`.
4. Read `nik list -p --json` and confirm the skill's `agents` holds your
   agent's id. Tell the user the skill name, source, label (from
   `installed @ <label>`), agents, and every finding.

When `nik add` prints another `nik add` command for a skill that the new skill
mentions, offer it to the user as a new install, starting from step 1.

## Update skills

1. Make a preview run. When the user names skills, pass only those names:
   `nik update <skill>... -p`. Use `nik update --all -p` only when they ask to
   update every skill. `nik` checks the sources upstream. For each selected
   skill with an update, it shows the diff stat, scans the changed files, and
   exits `2` at the confirmation without writing. Exit `0` with no scan means
   no update is due now.
2. Act on the findings as in step 2 of installing.
3. Rerun the preview command with `--yes`. When the user approved only some
   skills, name just those, in place of `--all` or the other names. Done when
   it exits `0`.

- A new upstream revision waits 3 days before `--all` takes it, so a
  hijacked release cannot reach everyone on day one. `minimumReleaseAge` in
  the project's `niksi.json` changes the wait. `nik` prints
  `<skill>: <revision> available, <age> old, waits for cooldown`. Update such
  a skill only when the user names it: `nik update <skill> -p`, then again
  with `--yes`.
- A pinned skill (`track` is `pin`) updates only when named.
- Updating a skill whose `modified` is `true` replaces the user's edits with
  upstream files. Ask the user first.

## Read installed skills

`nik list -p --json` and `nik list -g --json` print one JSON object on stdout,
one per scope. Read this output, not the table that `nik list` prints.

```json
{
  "scope": "project",
  "lockfile": "/work/repo/niksi-lock.json",
  "skills": [
    {
      "name": "pdf",
      "source": "https://github.com/anthropics/skills",
      "branch": "main",
      "path": "skills/pdf",
      "commit": "474e3e791559398762c4f5eff1399efe8f402156",
      "integrity": "sha256-...",
      "track": "auto",
      "tag": "v1.2.0",
      "agents": ["claude"],
      "modified": false,
      "links": ["/work/repo/.claude/skills/pdf"]
    }
  ]
}
```

| field | meaning |
| --- | --- |
| `source`, `path` | Where the skill came from: a Git URL or `local:` and a path, and the skill's directory in it. |
| `commit`, `tag`, `branch` | The installed revision. `tag` is present when the commit is a stable release. |
| `track`, `pinnedAs` | `auto` follows the latest stable tag, else the default branch. `pin` updates only when named. `pinnedAs` is the pinned tag or ref. |
| `agents` | Agent ids whose skills directory holds the skill on disk now. |
| `links` | The paths of the skill in those skills directories. |
| `modified` | `true` when the files on disk differ from what was reviewed. |
| `disabled` | `true` when the user disabled the skill. Absent otherwise. |
| `copy`, `copyPath` | The skill is a real directory, not a link. `copyPath` is its project directory. |
| `review.acceptedRules` | Critical rules that a person approved for these files. |

Each skill is in one state:

- Installed: `agents` is not empty, or for a `copyPath` entry,
  `<copyPath>/<name>` exists. `agents` and `links` are always empty for a
  `copyPath` entry.
- Missing: `agents` is empty, and `disabled` and `copyPath` are absent.
  `nik install -p` restores it from `niksi-lock.json`.
- Disabled: `nik enable <name> -p` restores it.
- Modified: `nik install -p --yes` restores the reviewed files of every
  modified skill in the scope and drops all their edits. `install` takes no
  skill names, so list every modified skill and ask the user first.

## Exit codes

| code | meaning |
| --- | --- |
| `0` | Done. |
| `1` | A skill failed and the rest ran. The message names the cause, such as an unreachable source or a source that the project's `niksi.json` doesn't allow. |
| `2` | `nik` needs an answer, the usage is invalid, or the project's `niksi.json` is invalid. After a preview run, that is the confirmation. Otherwise, read the message: pass the flag it names, or fix what it names. |
| `3` | The user must decide: critical findings, or warn findings under `policy.denyWarn`, blocked a skill, or in `update`, the project's `niksi.json` doesn't allow a skill's source. |

Every command, flag, and exit code is in
https://raw.githubusercontent.com/osrim/niksi/main/docs/commands.md.
