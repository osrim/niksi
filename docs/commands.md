# Commands

Commands, flags, aliases, and exit codes are compatibility contracts. Paths, environment variables, and the lockfile are in [configuration.md](configuration.md). The scan and its severities are in [security-scan.md](security-scan.md).

| command | alias | purpose |
| --- | --- | --- |
| `add <coordinate> [...skills]` | | Fetch, review, and add skills. |
| `install` | `i` | Restore every enabled skill in `niksi-lock.json`. |
| `update [...skills]` | `up` | Check upstream and update skills. |
| `remove [...skills]` | `rm` | Remove installed skills. |
| `list` | `ls` | Show installed skills. |
| `audit` | | Scan installed skills with the current rules. |
| `disable [...skills\|source]` | | Remove skills from disk and mark them disabled in `niksi-lock.json`. |
| `enable [...skills\|source]` | | Restore disabled skills from `niksi-lock.json`. |
| `prune` | | Delete unrecorded store entries. |
| `completion <shell>` | | Print a shell completion script. |

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
- When a forge URL names a directory, `add` searches only that directory.
  `https://github.com/o/r/tree/main/plugins/x` searches `plugins/x`.
  The lockfile records this discovery root as `root`.
- Named skills must exist in the source and have distinct names.
- `@ref` pins the skill. A pinned skill updates only when you name it in `nik update`.
- `add` shows and scans every file before writing. `Read files…` at the review questions opens the files in a pager. See [security-scan.md](security-scan.md).
- `add` offers to review missing dependencies mentioned by approved skills. With
  `--yes` or without a terminal, it prints a `nik add` command instead. This
  command uses the same discovery root.
- `add` skips a mentioned skill that the current scope records. An enabled skill
  in the other scope counts only when a link or agent copy is present in every
  selected agent directory. When it counts, `add` names that scope. Path copies
  do not count as other-scope dependencies, and exports with `--path` do not use
  other-scope dependencies.
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

For a local source, `install` reads the source directory even when the store holds the recorded content. If the source changed since `niksi-lock.json`, `install` skips the entry, names `nik update <skill>`, and exits `1`. If the source no longer has the skill, `install` skips the entry, names `nik remove <skill>`, and exits `1`.

Restoring a modified skill discards your edits, so `install` asks first. Without a terminal it keeps the edits and installs the other entries. `--yes` restores without asking.

Agent copies install to the agents recorded in the entry. Path copies install to their recorded destination roots.

Link entries install to the agents you pass with `--agent`, or to the saved or detected defaults. A lockfile without link entries selects no agents.

`install` skips disabled entries. It prints their count and names, and it names `nik enable`. It selects agents only when an enabled link entry exists. Its summary counts enabled entries only.

## `update`

```text
nik update [...skills] [-g|-p] [-a] [--source <coordinate>] [-y] [--dangerous-skip-critical-approval] [--report <file>]
```

`update` checks every installed skill against its source, then shows and scans changed files before writing.

- Without names, `--all`, or `--source`, it opens a picker of every skill with an available update.
- Pinned skills update only when named.
- `--source <coordinate>` selects the skills from one source as `--all` selects them from the scope. It leaves out pinned skills. `update` checks only that source upstream. The coordinate is `owner/repo`, a Git URL, or a local path. A local path selects every recorded skill in that directory or below it. `--source local` selects every local source. To select a directory named `local`, pass `./local`. `--all` with `--source` selects the same skills as `--source` alone.
- `--source` exits `2` when you pass it twice, pass it with skill names, or give it a coordinate with a skill segment, a forge URL path, or `@ref`. A source with no recorded skills exits `1`.
- Every update candidate goes through the same selection and confirmation. A skill whose revision moved without file changes shows `no file changes` instead of a diff and skips the review gate.
- A changed skill shows a diff stat. The full diff is in `Read files…` at the review questions. See [security-scan.md](security-scan.md#reading-files).
- Candidates not selected are reported as still having an update available.
- A pinned tag or branch that now resolves to a different commit is reported and never updated automatically.
- A named skill fails when its source no longer has it, its source is unreachable, or its pinned ref was rewritten. `update` reports it, updates the rest, and exits `1`. With `--all` or `--source` and no names, a failed skill that is not pinned also exits `1`. When a local source no longer has the skill, the message names `nik remove`.
- `update` reports missing dependencies but does not install them. If an entry
  has a `root`, both the check and the `nik add` command use that directory.
  `https://github.com/o/r/tree/main/plugins/x` searches `plugins/x`.
  For remote sources, the command uses the recorded branch. If absent, it uses
  `pinnedAs`, `tag`, or `commit`, in that order. Without any of these, `update`
  reports that it cannot generate the command.
- When only pinned skills mention a missing dependency, its `nik add` command
  ends the coordinate with `@<ref>`, so the dependency lands at the revision you
  reviewed. The ref is the new `pinnedAs` tag, or the commit when there is no
  tag or the tag has a character other than an ASCII letter, a digit, `.`, `_`,
  `+`, or `-`. In a forge URL, `@<ref>` takes precedence over the branch in the
  path. A dependency that a skill tracking `auto` mentions gets a command
  without `@ref`, so one source can print two commands.
- A dependency that the current scope records is not missing. An enabled
  dependency in the other scope counts only when a link or agent copy is present
  in every agent directory used by the updated skill. When it counts, `update`
  names that scope. Path copies follow the same rule as `add`.
- Updating a modified skill discards your edits. Run `nik install` to restore the locked files instead.
- `update` compares and updates each path copy at its recorded project-relative destination.
- `update` does not check disabled skills. It names them in one info line. With `--source`, it names only the disabled skills from that source. If you name a disabled skill, `update` exits `1` and names `nik enable`.
- `--report <file>` writes a Markdown review of the run. See [Update report](#update-report).

### Update report

`--report <file>` writes the outcome of the run as Markdown, for a pull request body or a job summary. A relative path resolves from the current directory. `update` overwrites the file.

The report has these sections. A section with no skills is left out.

- **Updated**: each written skill with its old and new revision, the diff stat, and its findings grouped by severity. A moved revision shows `No file changes.` instead.
- **Needs a person**: each skill that critical findings blocked, with the same detail and the `nik update` command to run in a terminal.
- **Not updated**: each other skill and its reason: declined at review, write not confirmed, update available but not selected, write failed, pinned, pinned ref rewritten, no longer in the source, no upstream, or disabled.
- **Up to date**: the names of the checked skills that had no update.

When every section is empty, the report says `No skill changed.` The report puts upstream text, such as tags, file names, and finding details, in code spans and fences, so a skill can't add Markdown or HTML to the page.

`update` writes the report at the end of every run that it finishes, including runs that change nothing or exit `3`. A missing directory for the file, or a path that is a directory, exits `2` before `update` checks upstream. If the file can't be written at the end, `update` reports the error and exits `1` unless an earlier failure set another code. An error that stops `update`, such as an unknown skill name, writes no report.

GitHub limits a pull request body to 65,536 characters. A run with many changed skills can exceed it, so post a long report as a comment or a job summary instead.

The report is Markdown only, for people who review the change. For machine checks, use the exit code, the diff of `niksi-lock.json`, and `nik audit --json`, which lists the findings of every installed skill.

## `remove`

```text
nik remove [...skills] [-g|-p] [-a] [-y]
```

`remove` deletes the selected lockfile entries and the links or copies that `niksi` created. For a path copy, it deletes only the named skill directory. It keeps the destination root and does not use the network.

Without names or `--all`, it opens a picker. `--all` selects every installed skill. `--yes` skips the confirmation.

`remove` also deletes disabled entries. The picker labels them `[disabled]`.

Before it confirms, `remove` warns when another installed skill in the same scope still mentions a selected skill. It prints one line per mentioned skill and names the skills that mention it:

```text
grilling is referenced by implement, wayfinder
```

The check reads the stored files of every other entry in the scope's lockfile, from any source, disabled ones included. It skips an entry whose files are missing from the store. `nik install` restores them. It also skips an entry whose stored files cannot be read, and names it in a warning. Mentions between selected skills do not count. It uses the same mention detection as `add`, so it can miss or over-match a mention. The warning never blocks. `--yes` proceeds.

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

## `audit`

```text
nik audit [-g|-p] [--json]
```

`audit` scans every installed skill with the current rules. `add` and `update` scan a skill once, when they write it. Run `audit` after you upgrade `niksi` to check skills you approved under older rules.

- `audit` reads the files on disk, not the store. A link entry reads its canonical copy. An agent copy reads the first copy present in a recorded agent's skills directory. A path copy reads its destination.
- `audit` does not use the network and does not write. It skips the update notice and its release check. When files from ski 0.2 need moving, it exits `1` and names `nik list`, which moves them.
- It prints the findings of each skill with their severities. It asks nothing, so a critical finding never needs a terminal.
- It skips disabled and missing skills and names them. Run `nik install` to restore a missing skill, then audit again.
- It does not report modified skills. `list` does.
- It takes no positional arguments; passing one exits `2`.
- A skill that cannot be read is reported on stderr and left out of the scan. The batch continues.
- It exits `3` when a skill has a critical finding, else `1` when a skill has a warn finding or cannot be read, else `0`. Info findings do not change the exit code.

`--json` writes one JSON object to stdout and nothing else. Diagnostics go to stderr. `skills` holds each scanned skill. `missing` and `disabled` hold the names of the skills `audit` did not scan.

```json
{
  "scope": "project",
  "lockfile": "/work/repo/niksi-lock.json",
  "skills": [
    {
      "name": "pdf",
      "source": "https://github.com/anthropics/skills",
      "path": "skills/pdf",
      "integrity": "sha256-...",
      "findings": [
        {
          "severity": "warn",
          "confidence": "medium",
          "rule": "prompt-injection",
          "help": "asks the agent to hide actions",
          "file": "SKILL.md",
          "line": 7,
          "detail": "Ignore previous instructions"
        }
      ]
    }
  ],
  "missing": [],
  "disabled": []
}
```

`file` and `line` are absent when a finding has no location. `confidence` is `high`, `medium`, or `low`. A `critical` match with `low` confidence has `severity` `warn`. Rule names and confidence are in [security-scan.md](security-scan.md#confidence).

## `disable`

```text
nik disable [...skills|source] [-g|-p] [-a] [-y]
```

`disable` deletes the links or copies of the selected skills, as `remove` does. It then sets `disabled: true` on each lockfile entry. The entry keeps its source, path, revision, integrity, and placement. `disable` also removes the patterns of a link from `.git/info/exclude`.

- Positional arguments are skill names. An argument that contains `/` names a source: `owner/repo`, a Git URL, or a local path. It selects every recorded skill from that source. A local path selects every recorded skill in that directory or below it. A source with a skill segment or `@ref` exits `2`.
- An unknown name, or a source with no recorded skills, exits `1`. The message lists the recorded skills.
- `--all` selects every enabled skill. Without names or `--all`, a picker opens. It groups skills by source. A group header selects the whole source.
- A skill that is already disabled prints `name: already disabled`. `disable` drops it from the batch.
- `disable` warns when a selected skill is modified, because it discards the edits. One confirmation covers the batch. `--yes` skips it.
- `disable` warns before it confirms when an enabled skill in the same scope still mentions a selected skill, as `remove` does. A disabled skill that mentions it does not count, because it does not run either.
- The disabled state is in `niksi-lock.json`. Commit it to share it. `install`, `update`, and `list` read it. `remove` deletes a disabled entry.

## `enable`

```text
nik enable [...skills|source] [-g|-p] [-a] [-y] [--agent <id>]
```

`enable` clears the mark and restores each skill as `install` does. It reads the store or the source and checks the recorded integrity. A local source must still have the skill and match the recorded integrity, as in `install`. It does not review, scan, or check dependencies.

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

## `completion`

```text
nik completion <shell>
```

`completion` prints a completion script for `bash`, `zsh`, or `fish` to stdout. The Homebrew formula installs all three. With npm or a downloaded binary, load the script yourself:

```sh
# bash, in ~/.bashrc
source <(nik completion bash)

# zsh, in ~/.zshrc after compinit
source <(nik completion zsh)

# fish
nik completion fish > ~/.config/fish/completions/nik.fish
```

The script completes command names, flags, `--agent` values, and file paths for `add`, `--path`, `--report`, and `--source`. For `update`, `remove`, `disable`, and `enable` it completes recorded skill names from the lockfile of the scope the command would use, so `-g` and `-p` on the command line count:

| command | completes |
| --- | --- |
| `update`, `disable` | enabled skills |
| `enable` | disabled skills |
| `remove` | every recorded skill |

To read skill names, the script runs `nik __complete-skills`, a hidden helper that reads the lockfile, never writes, and prints nothing when the lockfile cannot be read. The helper is not a compatibility contract, so don't call it from your own scripts.

A saved script doesn't pick up new commands and flags. Save it again after you upgrade `niksi`.

An unknown shell exits `2`.

## Flags

| flag | commands | effect |
| --- | --- | --- |
| `-g`, `--global` | all but `prune` and `completion` | Use global scope. |
| `-p`, `--project` | all but `prune` and `completion` | Use project scope. |
| `--agent <id>` | `add`, `install`, `enable` | Install to `universal`, `claude`, `opencode`, `kiro`, `cline`, or `qwen`. An agent name such as `cursor` or `codex` resolves to the directory that agent reads. Repeat the flag or separate values with commas. |
| `-a`, `--all` | `add`, `update`, `remove`, `disable`, `enable` | Select every skill. `disable` selects enabled skills and `enable` selects disabled skills. It does not confirm or approve anything. |
| `-y`, `--yes` | `add`, `install`, `update`, `remove`, `disable`, `enable`, `prune` | Accept ordinary confirmations and defaults. It cannot approve critical findings. |
| `--dangerous-skip-critical-approval` | `add`, `update` | Skip approval for critical findings. Dangerous. Files and findings remain visible. |
| `--copy` | `add` | Write directories instead of links. |
| `--path <directory>` | `add` | With `--copy`, write named skill directories below a project destination root. |
| `--json` | `list`, `audit` | Write JSON only. |
| `--report <file>` | `update` | Write a Markdown review report. |

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

On GitHub Actions, use the [`niksi` action](ci.md). On other CI systems, install a pinned release and check it against the release's `checksums.txt`. Every release has a `niksi-<os>-<arch>.tar.gz` for `linux-x64`, `linux-arm64`, `darwin-arm64`, and `darwin-x64`.

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

Git 2.30 or later must be on `PATH`. `nik install` exits `0` when every enabled entry in `niksi-lock.json` is on disk with its recorded integrity and every local source still matches it. It exits `1` when a local skill's source changed since `niksi-lock.json` or no longer has the skill. Run `nik update <skill>` or `nik remove <skill>` and commit the lockfile. `CI` disables the update notice and its release check.

`nik add` and `nik update` also run without a terminal. `--yes` accepts warn findings. A critical finding exits `3` unless `--dangerous-skip-critical-approval` skips approval. `nik list --json` prints machine-readable output.

For reviewed sources whose critical findings you accept, use CI to keep a repository's published skill copies current. Every run still lists files, scans them, and prints all findings:

```sh
nik add owner/skills --all --yes --copy --path ./custom-directory --dangerous-skip-critical-approval
nik update --all --yes --dangerous-skip-critical-approval
git diff --exit-code niksi-lock.json ./custom-directory
```

To record the new integrity of a project's own skills after an edit, update only local sources. Git sources keep their own review cadence:

```sh
nik update --source local --yes
git diff --quiet niksi-lock.json || git commit -m "chore: record skill integrity" niksi-lock.json
```

To open a pull request for updates, write a report and use it as the body. Without `--dangerous-skip-critical-approval`, a skill with critical findings stays at its recorded revision and the command exits `3`. The report lists it under **Needs a person**, so the pull request still carries the other updates:

```sh
report="$(mktemp)"
status=0
nik update --all --yes --report "$report" || status=$?
[ "$status" -eq 0 ] || [ "$status" -eq 3 ] || exit "$status"
git diff --quiet niksi-lock.json && exit "$status"
git switch -c skill-updates
git add -A
git commit -m "chore: update skills"
git push -u origin skill-updates
gh pr create --title "chore: update skills" --body-file "$report"
```

The report is written outside the repository, so `git add -A` does not commit it. When critical findings block every update, nothing changes and the script exits `3`, so the job fails instead of hiding the findings.

## Exit codes

| code | meaning |
| --- | --- |
| `0` | Success or nothing to do. |
| `1` | A skill failed. The rest of the batch still ran. In `install` and `enable`, this includes a local source that changed since `niksi-lock.json` or no longer has the skill. In `audit`, also a warn finding. |
| `2` | Invalid usage, or a prompt had no terminal and no flag. |
| `3` | Critical findings blocked at least one skill in `add` or `update` without `--dangerous-skip-critical-approval`. In `audit`, a critical finding in an installed skill. |
| `130` | Cancelled. |
