# Commands

Commands, flags, aliases, and exit codes are compatibility contracts. Paths, environment variables, and the lockfile are in [configuration.md](configuration.md). The scan and its severities are in [security-scan.md](security-scan.md).

| command | alias | purpose |
| --- | --- | --- |
| `add <coordinate> [...skills]` | | Fetch, review, and add skills. |
| `install` | `i` | Restore every enabled skill in `niksi-lock.json`. |
| `update [...skills]` | `up` | Check upstream and update skills. |
| `remove [...skills]` | `rm` | Remove installed skills. |
| `list` | `ls` | Show installed skills. |
| `disable [...skills\|source]` | | Remove skills from disk and mark them disabled in `niksi-lock.json`. |
| `enable [...skills\|source]` | | Restore disabled skills from `niksi-lock.json`. |
| `prune` | | Delete store entries that no lockfile records. |

`nik --help` and `nik <command> --help` print usage. `nik --version` prints the version, platform, and Bun version.

## `add`

```text
nik add <coordinate> [...skills] [-g|-p] [-a] [-y] [--agent <id>] [--copy [--path <directory>]] [--dangerous-skip-critical-approval]
```

A coordinate names a source:

```text
owner/repo                        GitHub repository
owner/repo/pdf                    skill named pdf
owner/repo/skills/pdf             skill at path skills/pdf
owner/repo@v1.2.0                 pinned ref
https://github.com/o/r/tree/main  forge URL
git@github.com:owner/repo.git     clone URL
./skills/my-skill                 local directory
```

`owner/repo` always means GitHub. Every other forge needs a full URL. Segments after `owner/repo` name one skill: its path in the source, or else a skill whose name is the last segment. A URL path is the repository, so name the skill as a positional argument instead.

`niksi` rejects plain `http://` URLs, URLs that carry a username or password, and any coordinate that contains `#`.

- Without skill names, `add` opens a picker. A source with one skill skips the picker.
- `--all` selects every skill in the source.
- Named skills must exist in the source and have distinct names.
- `@ref` pins the skill. A pinned skill updates only when you name it in `nik update`.
- `add` shows and scans every file before writing. See [security-scan.md](security-scan.md).
- `add` finds mentions of other skills from the same source and offers to review them too.
- `--copy` writes a real directory instead of a link. To switch a skill between link and copy, remove it and add it again.
- In project scope, a local directory outside the project root, or a symlink to one, is recorded by a path that other machines cannot resolve. `add` warns and asks before it records it. `-y` answers yes. Use `--copy` to put the files in the project, or `-g` to install for this machine only.
- `--path <directory>` writes each selected skill to `<directory>/<skill name>`. It requires `--copy` and selects project scope. It skips agent selection.
- Do not combine `--path` with `--global` or `--agent`. Relative paths resolve from the project root. Absolute paths must resolve inside the project root.
- A path cannot contain `..` or escape the project root through a symlinked ancestor.
- A matching lockfile entry manages an existing path-copy destination. `niksi` skips other existing directories and continues the batch.
- `add` holds a disabled skill from the same source. It names `nik enable` and does not offer to extend the skill to more agents.

## `install`

```text
nik install [-g|-p] [-y] [--agent <id>]
```

`install` restores every enabled lockfile entry. It takes no positional arguments; passing one exits `2`.

`install` does not scan. `add` or `update` reviewed every entry, and `install` verifies each file against the recorded integrity before writing it. An entry whose content does not match is skipped and the command exits `1`.

Restoring a modified skill discards your edits, so `install` asks first. Without a terminal it keeps the edits and installs the other entries. `--yes` restores without asking.

Agent copies install to the agents recorded in the entry. Path copies install to their recorded destination roots.

Link entries install to the agents you pass with `--agent`, or to the saved or detected defaults. A lockfile without link entries selects no agents.

`install` skips disabled entries. It prints their count and names, and it names `nik enable`. It selects agents only when an enabled link entry exists. Its summary counts enabled entries only.

## `update`

```text
nik update [...skills] [-g|-p] [-a] [-y] [--dangerous-skip-critical-approval]
```

`update` checks every installed skill against its source, then shows and scans changed files before writing.

- Without names or `--all`, it opens a picker of outdated skills.
- Pinned skills update only when named.
- A skill whose files did not change at a new revision updates without review.
- A pinned tag or branch that now resolves to a different commit is reported and never updated automatically.
- Missing dependencies are reported, not installed.
- Updating a modified skill discards your edits. Run `nik install` to restore the locked files instead.
- `update` compares and updates each path copy at its recorded project-relative destination.
- `update` does not check disabled skills. It names them in one info line. If you name a disabled skill, `update` exits `1` and names `nik enable`.

## `remove`

```text
nik remove [...skills] [-g|-p] [-a] [-y]
```

`remove` deletes the selected lockfile entries and the links or copies that `niksi` created. For a path copy, it deletes only the named skill directory. It keeps the destination root and does not use the network.

Without names or `--all`, it opens a picker. `--all` selects every installed skill. `--yes` skips the confirmation.

`remove` also deletes disabled entries. The picker labels them `[disabled]`.

## `list`

```text
nik list [-g|-p] [--json]
```

`list` shows every lockfile entry with its revision and location. It marks missing skills and skills whose files differ from the lockfile.

Path copies show their project-relative destination. A disabled skill shows `disabled` in the location column. `list` does not count it as missing. The summary adds `N disabled`. `list` does not use the network.

`--json` writes one JSON object to stdout and nothing else. Diagnostics go to stderr.

```json
{
  "scope": "project",
  "lockfile": "/work/repo/niksi-lock.json",
  "skills": [
    {
      "name": "pdf",
      "source": "https://github.com/anthropics/skills",
      "path": "skills/pdf",
      "commit": "474e3e791559398762c4f5eff1399efe8f402156",
      "integrity": "sha256-...",
      "track": "auto",
      "branch": "main",
      "copy": true,
      "copyPath": "custom-directory",
      "disabled": true,
      "modified": false,
      "agents": [],
      "links": []
    }
  ]
}
```

Each skill carries its lockfile fields (see [configuration.md](configuration.md#lockfile)) plus `modified`, `agents`, and `links`. The `agents` and `links` fields report what is on disk. A disabled entry carries `disabled: true` with empty `agents` and `links`. Its lockfile `agents` or `copyPath` stays recorded so `enable` can restore the placement.

## `disable`

```text
nik disable [...skills|source] [-g|-p] [-a] [-y]
```

`disable` deletes the links or copies of the selected skills, as `remove` does. It then sets `disabled: true` on each lockfile entry. The entry keeps its source, path, revision, integrity, and placement. `disable` also removes the patterns of a link from `.git/info/exclude`.

- Positional arguments are skill names. An argument that contains `/` names a source: `owner/repo`, a Git URL, or a local path. It selects every recorded skill from that source. A source with a skill segment or `@ref` exits `2`.
- An unknown name, or a source with no recorded skills, exits `1`. The message lists the recorded skills.
- `--all` selects every enabled skill. Without names or `--all`, a picker opens. It groups skills by source. A group header selects the whole source.
- A skill that is already disabled prints `name: already disabled`. `disable` drops it from the batch.
- `disable` warns when a selected skill is modified, because it discards the edits. One confirmation covers the batch. `--yes` skips it.
- The disabled state is in `niksi-lock.json`. Commit it to share it. `install`, `update`, and `list` read it. `remove` deletes a disabled entry.

## `enable`

```text
nik enable [...skills|source] [-g|-p] [-a] [-y] [--agent <id>]
```

`enable` clears the mark and restores each skill as `install` does. It reads the store or the source and checks the recorded integrity. It does not review, scan, or check dependencies.

- Select skills and sources as in `disable`. `--all` selects every disabled skill. A skill that is already enabled prints `name: already enabled`.
- Link entries need agents. `enable` uses `--agent`, else the remembered choice, else the detected defaults, else a prompt. Agent copies and path copies restore to their recorded agents or destination root. A selection with no link entries selects no agents.
- If the content of an entry does not match its integrity, `enable` reports it as `install` does. The entry stays disabled. The command exits `1`.

For global scope, `lockfile` reports the effective path: the config path, or the legacy data path while `niksi` still uses one. See [Moving an existing global lockfile](configuration.md#moving-an-existing-global-lockfile).

## `prune`

```text
nik prune [-y]
```

`prune` deletes every unrecorded entry in the store. An unrecorded entry is one of:

- a store entry that neither the global lockfile nor the current project's lockfile records
- a temporary directory that an interrupted download left behind
- any other file or directory under the store

`prune` also deletes a source directory that becomes empty. `prune` deletes a symlink as a link and never follows it.

`prune` keeps every entry that the global lockfile or the current project's lockfile records, so `nik install` in both scopes still works without the network. `prune` deletes entries that only other projects record. The next `install` in such a project fetches them again.

`prune` shows the plan grouped by source, with the size of each entry and the total, then asks. The default answer is no. `--yes` skips the question. `prune` prints how many entries it deleted and how much space it freed. It prints `Nothing to prune.` when the store is clean or does not exist.

`prune` never touches installed skills, agent links, copies, or any lockfile. The store is one directory for every scope, so `-g` and `-p` are unknown options and exit `2`. A positional argument exits `2`. A lockfile that does not parse stops the command before it deletes anything. `prune` reports and skips an entry that it cannot delete, and the command exits `1`.

## Flags

| flag | commands | effect |
| --- | --- | --- |
| `-g`, `--global` | all but `prune` | Use global scope. |
| `-p`, `--project` | all but `prune` | Use project scope. |
| `--agent <id>` | `add`, `install`, `enable` | Install to `universal`, `claude`, `opencode`, `kiro`, `cline`, or `qwen`. An agent name such as `cursor` or `codex` resolves to the directory that agent reads. Repeat the flag or separate values with commas. |
| `-a`, `--all` | `add`, `update`, `remove`, `disable`, `enable` | Select every skill. `disable` selects enabled skills and `enable` selects disabled skills. It does not confirm or approve anything. |
| `-y`, `--yes` | `add`, `install`, `update`, `remove`, `disable`, `enable`, `prune` | Accept ordinary confirmations and defaults. It cannot approve critical findings. |
| `--dangerous-skip-critical-approval` | `add`, `update` | Skip approval for critical findings. Dangerous. Files and findings remain visible. |
| `--copy` | `add` | Write directories instead of links. |
| `--path <directory>` | `add` | With `--copy`, write named skill directories below a project destination root. |
| `--json` | `list` | Write JSON only. |

`-g` and `-p` cannot be combined. Passing both exits `2`. An unknown `--agent` value exits `2`.

`--dangerous-skip-critical-approval` applies only to the current invocation, including dependencies reviewed by `add`. It does not imply `--yes`, `--all`, a scope, an agent, `--copy`, or `--path`. Warn finding review and write confirmation keep their existing behavior. The flag is never saved in the lockfile or configuration and has no environment-variable equivalent.

`add` asks for the scope when neither flag is present. `--path` selects project scope without asking. The other commands default to project scope.

Running a command from your home directory selects global scope.

## Non-interactive use

`niksi` prompts when it needs a decision. Each prompt has a flag replacement:

| prompt | replacement |
| --- | --- |
| Which skills | Pass names or `--all`. |
| Which skills to disable or enable | Pass names, a source, or `--all`. |
| Scope or agents | Pass `-g`, `-p`, or `--agent`. |
| Path-copy destination | Pass `--copy --path <directory>`. Do not pass an agent flag. |
| Write confirmation | Pass `--yes`. |
| Warn finding review | Pass `--yes`. |
| Critical finding approval | Run in a terminal, or pass `--dangerous-skip-critical-approval` to skip approval. |

An ordinary prompt with no terminal and no replacement flag exits `2`. In `add` and `update`, critical findings instead block the skill with exit `3` unless `--dangerous-skip-critical-approval` is provided. `install` keeps modified skills and continues when there is no terminal.

Ctrl-C exits `130`. Files already written stay written.

## CI

Install a pinned release and check it against the release's `checksums.txt`. Every release has a `niksi-<os>-<arch>.tar.gz` for `linux-x64`, `linux-arm64`, `darwin-arm64`, and `darwin-x64`.

```sh
set -e
NIKSI_VERSION=0.3.0
BASE="https://github.com/osrim/niksi/releases/download/v$NIKSI_VERSION"
curl -fsSLO "$BASE/niksi-linux-x64.tar.gz"
curl -fsSL "$BASE/checksums.txt" | grep niksi-linux-x64.tar.gz | sha256sum -c -
tar xzf niksi-linux-x64.tar.gz
install -m 755 nik /usr/local/bin/nik

nik install --agent claude --yes
```

`git` must be on `PATH`. `nik install` exits `0` when every enabled entry in `niksi-lock.json` is on disk with its recorded integrity. `CI` disables the update notice and its release check.

`nik add` and `nik update` also run without a terminal. `--yes` accepts warn findings. A critical finding exits `3` unless `--dangerous-skip-critical-approval` skips approval. `nik list --json` prints machine-readable output.

For reviewed sources whose critical findings you accept, use CI to keep a repository's published skill copies current. Every run still lists files, scans them, and prints all findings:

```sh
nik add owner/skills --all --yes --copy --path ./custom-directory --dangerous-skip-critical-approval
nik update --all --yes --dangerous-skip-critical-approval
git diff --exit-code niksi-lock.json ./custom-directory
```

## Exit codes

| code | meaning |
| --- | --- |
| `0` | Success or nothing to do. |
| `1` | A skill failed. The rest of the batch still ran. |
| `2` | Invalid usage, or a prompt had no terminal and no flag. |
| `3` | Critical findings blocked at least one skill in `add` or `update` without `--dangerous-skip-critical-approval`. |
| `130` | Cancelled. |
