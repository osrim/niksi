# Commands

Commands, flags, aliases, and exit codes are compatibility contracts. Paths, environment variables, and the lockfile are in [configuration.md](configuration.md). The scan and its severities are in [security-scan.md](security-scan.md).

| command | alias | purpose |
| --- | --- | --- |
| `add <coordinate> [...skills]` | | Fetch, review, and add skills. |
| `adopt [...skills]` | | Record skills that are already in agent skills directories. |
| `install` | `i` | Restore every enabled skill in `niksi-lock.json`. |
| `update [...skills]` | `up` | Check upstream and update skills. |
| `outdated` | | Show which skills have upstream updates. |
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
nik add <coordinate> [...skills] [-g|-p] [-a] [-y] [--agent <id>] [--copy [--path <directory>]] [--dangerous-skip-critical-approval] [--min-release-age <days>]
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

`owner/repo` always means GitHub. Every other forge needs a full URL. A URL path is the repository, so name the skill as a positional argument instead.

Segments after `owner/repo` name one skill. `add` resolves them in this order:

1. The path of a skill that discovery finds in the source.
2. A directory in the source that holds `SKILL.md`. That directory becomes the discovery root, as if you had typed its forge URL. This reaches skills that discovery skips, such as skills in hidden directories like `.claude/skills/x`.
3. A skill whose name is the last segment.

`niksi` rejects plain `http://` URLs, URLs that carry a username or password, and any coordinate that contains `#`.

- Without skill names, `add` opens a picker. A source with one skill skips the picker.
- `--all` selects every skill in the source.
- When a forge URL names a directory, `add` searches only that directory.
  `https://github.com/o/r/tree/main/plugins/x` searches `plugins/x`.
  The lockfile records this discovery root as `root`.
- Named skills must exist in the source and have distinct names.
- `@ref` pins the skill. A pinned skill updates only when you name it in `nik update`.
- Without `@ref`, `add` installs the upstream revision even when it is younger than the [cooldown](#cooldown), and prints one warning with its age: `v2.0.0 is 1 day old, inside the 3-day cooldown.` `--min-release-age 0` turns the warning off.
- `add` shows and scans every file before writing. `Read files…` at the review questions opens the files in a pager. See [security-scan.md](security-scan.md).
- In project scope, `add` checks the source against the policy in `niksi.json` before it fetches anything, so it asks for the scope first. When the policy doesn't allow the source, `add` names it, adds nothing, and exits `1`. See [Project configuration](configuration.md#project-configuration).
- When `niksi.json` sets `policy.denyWarn`, a warn finding needs approval like a critical one, and `--yes` doesn't accept it. See [security-scan.md](security-scan.md#severities).
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

## `adopt`

```text
nik adopt [...skills] [-g|-p] [-a] [-y] [--source <coordinate>] [--dangerous-skip-critical-approval]
```

`adopt` records skills that you installed by hand, with `gh skill`, or with
`npx skills`, so `niksi` manages them from then on. It leaves each skill where
it is.

`adopt` looks in every skills directory of the scope (see
[configuration.md](configuration.md#agents)) for a directory that holds
`SKILL.md` and that the lockfile does not record. Links that `niksi` wrote are
not offered.

- Without names or `--all`, a picker opens. `--all` selects every unmanaged
  skill. An unknown name exits `1` and lists the unmanaged skills. A recorded
  name prints `name: already recorded`.
- The same skill in two skills directories is one skill when the copies have
  the same files. A symlink to a copy in another skills directory, as
  `npx skills` writes, counts as that copy. `adopt` skips a skill whose copies
  differ, or a symlink to a directory outside the skills directories, and says
  what to do. Naming a skipped skill exits `1`.

`adopt` then looks for the source of each skill, in this order:

1. The source you pass with `--source <coordinate>`: `owner/repo`, a Git URL,
   or a local path. It exits `2` for a coordinate with a skill segment, a forge
   URL path, or `@ref`, or when you pass it twice.
2. The `metadata` keys that `gh skill install` writes in `SKILL.md`:
   `github-repo`, `github-path`, `github-tree-sha`, and `github-pinned`.
   `adopt` uses `github-repo` only when it's an `https://` URL, as `gh skill`
   writes it.
3. The entry with the skill's name in the lockfile of `npx skills`:
   `skills-lock.json` at the project root in project scope, or
   `~/.agents/.skill-lock.json` in global scope. Entries from a Git
   repository count. Local and npm entries don't.

A source from `SKILL.md` or from the `npx skills` lockfile can't ask you for
anything: SSH fails instead of asking for a passphrase or for approval of an
unknown host key. An SSH source works when your key and the host's key are
already set up.

`adopt` compares the files with the source. A Git source is checked at the
latest release, the head of the default branch, and the last 100 commits that
changed the skill. A pinned ref from `gh skill` or `npx skills` is checked at
that ref only.

- When the files match, the entry records that source and the commit that
  holds those files, with `track: auto`, or `track: pin` for a pinned ref.
  `nik update` then compares it with the source as it does any other entry.
- A `gh skill` copy matches when its `SKILL.md` differs from the source only
  by the keys that `gh skill` writes under `metadata` and by the layout of the
  frontmatter. `adopt` writes the source's `SKILL.md` over the copy, which
  drops those keys. It leaves every other file in the directory alone.
- When no source is known, or the files differ from the source, `adopt` keeps
  your files and records the skill directory itself as a local source. Run
  `nik update` to record later edits. `nik disable` refuses such a skill,
  because removing its files would delete its source.
- When a source can't be reached, `adopt` skips the skill and exits `1`.
- In project scope, `adopt` checks each source against the policy in
  `niksi.json` before it fetches anything. When the policy doesn't allow a
  source from `SKILL.md` or the `npx skills` lockfile, `adopt` names the skill
  and its source, skips it, adopts the other skills, and exits `1`. When it
  doesn't allow the source you pass with `--source`, `adopt` adopts nothing and
  exits `1`. Local sources always pass. See
  [Project configuration](configuration.md#project-configuration).

Every entry is an agent copy for the skills directories that hold the skill.
Before it writes, `adopt` shows each skill with its source and revision, lists
and scans its files as `add` does, and asks once to confirm. `--yes` accepts
warn findings and the confirmation, unless `niksi.json` sets
`policy.denyWarn`: then a warn finding needs approval like a critical one. A
critical finding needs a terminal, or
`--dangerous-skip-critical-approval`, and otherwise exits `3`.

`adopt` writes no files except the `SKILL.md` of a `gh skill` copy. If a
skill's files change between the scan and the write, `adopt` skips it and
exits `1`.

## `install`

```text
nik install [-g|-p] [-y] [--agent <id>] [--frozen-lockfile]
```

`install` restores every enabled lockfile entry. It takes no positional arguments; passing one exits `2`.

Without a lockfile, `install` prints `Nothing to install.` and exits `0`. With `--frozen-lockfile`, it names the lockfile path it looked for, installs nothing, and exits `1`. Use it in CI, so a job without `niksi-lock.json` fails instead of passing with no skills. A lockfile with no skills passes.

`install` does not scan. `add` or `update` reviewed every entry, and `install` verifies each file against the recorded integrity before writing it. An entry whose content does not match is skipped and the command exits `1`.

In project scope, `install` first checks every enabled entry against the policy in `niksi.json`. When an entry comes from a source that the policy doesn't allow, `install` names each such entry and its source, installs nothing, and exits `1`. See [Project configuration](configuration.md#project-configuration).

For a local source, `install` reads the source directory even when the store holds the recorded content. If the source changed since `niksi-lock.json`, `install` skips the entry, names `nik update <skill>`, and exits `1`. If the source no longer has the skill, `install` skips the entry, names `nik remove <skill>`, and exits `1`.

Restoring a modified skill discards your edits, so `install` asks first. Without a terminal it keeps the edits and installs the other entries. `--yes` restores without asking.

Agent copies install to the agents recorded in the entry. Path copies install to their recorded destination roots.

Link entries install to the agents recorded in the entry. A link entry without recorded agents, such as one from a version 1 lockfile, installs to the agents you pass with `--agent`, or to the saved or detected defaults. A lockfile without such an entry selects no agents, and `install --agent` says that it ignores the flag. `install` does not write the lockfile, so it does not record those agents.

`install` skips disabled entries. It prints their count and names, and it names `nik enable`. It selects agents only when an enabled link entry without recorded agents exists. Its summary counts enabled entries only.

## `update`

```text
nik update [...skills] [-g|-p] [-a] [--source <coordinate>] [-y] [--dangerous-skip-critical-approval] [--report <file>] [--min-release-age <days>]
```

`update` checks every installed skill against its source, then shows and scans changed files before writing.

- Without names, `--all`, or `--source`, it opens a picker of every skill with an available update.
- Pinned skills update only when named.
- `--all` and `--source` leave out a changed skill whose upstream revision is younger than the [cooldown](#cooldown). The picker lists it unselected.
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
- In project scope, `update` leaves out each skill whose source the policy in `niksi.json` doesn't allow, and doesn't check that source upstream. It names each such skill and its source, keeps it at its recorded revision, updates the other skills, and exits `3`. Remove the skill with `nik remove`, or allow its source in `niksi.json`. See [Project configuration](configuration.md#project-configuration).
- When `niksi.json` sets `policy.denyWarn`, a warn finding in changed files needs approval like a critical one, and `--yes` doesn't accept it. See [security-scan.md](security-scan.md#severities).
- `--report <file>` writes a Markdown review of the run. See [Update report](#update-report).

### Cooldown

An upstream revision that changes a skill's files waits 3 days before `update` takes it on its own, so a tag pushed from a hijacked maintainer account doesn't reach every `nik update --all --yes` the same day. The age is the Git committer date of the revision `update` would move to: the commit of the latest stable tag, or the head of the branch when the source has no tag. A commit dated in the past passes at once; see [security-scan.md](security-scan.md#limits). When a source has no tag and its branch gets a commit at least every few days, a changed skill from it can keep waiting under `--all`, because each new commit is young. Run `nik update <skill>` to update it.

- `--all` and `--source` leave a waiting skill at its recorded revision and print why:

  ```text
  tdd: v2.0.0 available, 1 day old, waits for cooldown
  Run nik update tdd to update it now.
  ```

- The picker shows each candidate's age and marks a waiting one with `waits for cooldown`. Pick it to update it now. A waiting skill you leave unpicked prints the same lines.
- Naming a skill updates it now: `nik update tdd`. So does an explicit ref in `nik add owner/repo/tdd@v2`.
- `--yes` accepts confirmations, not upstream revisions. A waiting skill keeps waiting.
- A skill whose revision moved without file changes has no cooldown. `--all` and `--source` take it at once, and the picker doesn't mark it as waiting.
- Pinned skills and local sources have no cooldown.
- `minimumReleaseAge` in a project's `niksi.json` sets the cooldown for that project. See [Project configuration](configuration.md#project-configuration).
- `--min-release-age <days>` sets the cooldown for one run, over `niksi.json`. `0` turns it off.

### Update report

`--report <file>` writes the outcome of the run as Markdown, for a pull request body or a job summary. A relative path resolves from the current directory. `update` overwrites the file.

The report has these sections. A section with no skills is left out.

- **Updated**: each written skill with its old and new revision, the diff stat, and its findings grouped by severity. A moved revision shows `No file changes.` instead.
- **Needs a person**: each skill that critical findings blocked, or warn findings under `policy.denyWarn`, with the same detail and the `nik update` command to run in a terminal. Then each skill whose source the project policy doesn't allow, with its source.
- **Not updated**: each other skill and its reason: declined at review, write not confirmed, update available but not selected, waiting for the cooldown with the upstream revision's age, write failed, pinned, pinned ref rewritten, no longer in the source, no upstream, or disabled.
- **Up to date**: the names of the checked skills that had no update.

When every section is empty, the report says `No skill changed.` The report puts upstream text, such as tags, file names, and finding details, in code spans and fences, so a skill can't add Markdown or HTML to the page.

`update` writes the report at the end of every run that it finishes, including runs that change nothing or exit `3`. A missing directory for the file, or a path that is a directory, exits `2` before `update` checks upstream. If the file can't be written at the end, `update` reports the error and exits `1` unless an earlier failure set another code. An error that stops `update`, such as an unknown skill name, writes no report.

GitHub limits a pull request body to 65,536 characters. A run with many changed skills can exceed it, so post a long report as a comment or a job summary instead.

The report is Markdown only, for people who review the change. For machine checks, use the exit code, the diff of `niksi-lock.json`, and `nik audit --json`, which lists the findings of every installed skill.

## `outdated`

```text
nik outdated [-g|-p] [--json]
```

`outdated` checks every enabled skill against its source and shows which skills have an update. It doesn't install, update, or record anything. It never asks: ssh fails instead of asking for a host key or a passphrase. It runs the same with or without a terminal. Run `nik update` to review and apply the updates.

- It checks the same upstream revision as `update`: the latest stable tag, or the head of the branch when the source has no tag. A pinned skill shows the revision that `nik update <skill>` would move it to.
- It ignores the [cooldown](#cooldown). A skill with a young upstream revision still counts as outdated.
- It doesn't check disabled skills. It names them in one info line.
- In project scope, it doesn't check a skill whose source the policy in `niksi.json` doesn't allow. It names each such skill and its source. See [Project configuration](configuration.md#project-configuration).
- It takes no positional arguments; passing one exits `2`.

`--json` writes one JSON object to stdout and nothing else. Diagnostics go to stderr. `skills` holds each checked skill, sorted by name. `disabled` holds the names of disabled skills, and `blocked` holds the names of skills that the project policy left out. `outdated` checks neither.

```json
{
  "scope": "project",
  "lockfile": "/work/repo/niksi-lock.json",
  "skills": [
    {
      "name": "pdf",
      "source": "https://github.com/anthropics/skills",
      "path": "skills/pdf",
      "track": "auto",
      "verdict": "outdated",
      "recorded": {
        "commit": "474e3e791559398762c4f5eff1399efe8f402156",
        "tag": "v1.0.0"
      },
      "upstream": {
        "commit": "9d1c2b7f0a6e4d3c8b5a2f1e0d9c8b7a6f5e4d3c",
        "tag": "v1.1.0"
      }
    }
  ],
  "disabled": [],
  "blocked": []
}
```

`recorded` is the revision in `niksi-lock.json`. `upstream` is the revision that the skill would move to. Each one carries `commit`, `tag`, and `pinnedAs` when it has them, with the meaning they have in the lockfile (see [lockfile.md](lockfile.md#entry-fields)). A local source has no commit or tag, so both objects are empty. `upstream` is empty for an `unreachable` skill. For a `gone` skill, it is the revision that no longer has the skill. For a `rewritten` skill, it is the latest upstream revision, and `update` doesn't move the skill there. `track` is `auto` or `pin`.

`verdict` is one of these values:

| verdict | meaning |
| --- | --- |
| `up-to-date` | The installed files match upstream and the revision didn't move. |
| `outdated` | The upstream files differ from the installed files. |
| `moved` | The upstream revision changed, but the skill's files didn't. |
| `pinned` | The skill is pinned, and upstream has a newer revision. Only `nik update <skill>` takes it. |
| `rewritten` | The pinned tag or branch now resolves to a different commit. |
| `gone` | The source no longer has the skill at its recorded path. |
| `unreachable` | The source can't be cloned or fetched. The skill also has an `error` field with the message. |

`outdated` exits with these codes, with or without `--json`:

- `0`: every checked skill is `up-to-date`.
- `1`: at least one skill has another verdict. Read `verdict` to see which. `1` also means an error stopped `outdated` before it checked any skill, such as an unreadable `niksi-lock.json`. Then stdout is empty.
- `2`: invalid usage, or an invalid `niksi.json`.
- `3`: the project policy left out at least one skill. It takes precedence over `1`.

To check for updates in a script:

```sh
status=0
nik outdated --json > outdated.json || status=$?
[ "$status" -le 1 ] || exit "$status"
jq -e .skills outdated.json > /dev/null || exit 1
jq -r '.skills[] | select(.verdict != "up-to-date") | "\(.name): \(.verdict)"' outdated.json
```

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
      "state": "disabled",
      "modified": false,
      "agents": [],
      "links": []
    }
  ]
}
```

Each skill carries its lockfile fields (see [lockfile.md](lockfile.md#entry-fields)) plus `state`, `modified`, `agents`, and `links`. The `agents` and `links` fields report what is on disk.

`state` is one of these values:

| state | meaning |
| --- | --- |
| `installed` | A link or copy is at its recorded location, and its files match the lockfile. |
| `modified` | A link or copy is at its recorded location, and its files differ from the lockfile. `nik install` asks before it restores them. |
| `missing` | No link or copy is at its recorded location. `nik install` restores it. |
| `disabled` | `nik disable` removed it on purpose. `nik enable` restores it. |

A link or agent copy counts as at its recorded location when at least one agent has it, as in the `nik list` table. A link counts only when it leads to its canonical copy. To find an entry that is missing for some of its agents, compare `agents` with the lockfile entry's `agents`. `modified` stays `true` for a missing link entry whose canonical copy has edits, but its `state` is `missing`. A disabled entry carries `disabled: true` with empty `agents` and `links`. Its lockfile `agents` or `copyPath` stays recorded so `enable` can restore the placement.

## `audit`

```text
nik audit [-g|-p] [--json]
```

`audit` scans every installed skill with the current rules. `add` and `update` scan a skill once, when they write it. Run `audit` after you upgrade `niksi` to check skills you approved under older rules.

- `audit` reads the files on disk, not the store. A link entry reads its canonical copy. An agent copy reads every copy present in a recorded agent's skills directory and scans copies with the same content once. A path copy reads its destination.
- `audit` does not use the network and does not write. It skips the update notice and its release check. When files from ski 0.2 need moving, it exits `1` and names `nik list`, which moves them.
- It prints the findings of each skill with their severities. It asks nothing, so a critical finding never needs a terminal.
- A critical finding whose rule id the lockfile entry lists in `review.acceptedRules` is accepted: `add` or `update` approved it for that content. `audit` still prints it with its severity, marks it `(accepted)`, and counts it in the summary as `N accepted finding(s)`, apart from the other findings. It does not change the exit code. See [security-scan.md](security-scan.md#accepted-findings).
- An acceptance holds only while the files on disk match the entry's `integrity`. For an agent copy, every present copy must match. For a modified skill, `audit` accepts no finding and says that the skill is modified.
- It skips disabled and missing skills and names them. Run `nik install` to restore a missing skill, then audit again.
- It reports a modified skill only when the entry accepts rules. `list` reports every modified skill.
- In project scope, when `niksi.json` sets `policy.denyWarn`, a warn finding fails the audit like a critical one, and `audit` says that the policy is why. Global scope ignores `niksi.json`. See [Project configuration](configuration.md#project-configuration).
- It takes no positional arguments; passing one exits `2`.
- A skill that cannot be read is reported on stderr and left out of the scan. The batch continues.
- It exits `3` when a skill has a critical finding that is not accepted, or a warn finding under `policy.denyWarn`, else `1` when a skill has a warn finding or cannot be read, else `0`. Info findings and accepted critical findings do not change the exit code. In project scope, an invalid `niksi.json` exits `2`.

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

`file` and `line` are absent when a finding has no location. An accepted critical finding has `accepted: true`. Other findings have no `accepted` field. Under `policy.denyWarn`, each warn finding has `deniedBy: "policy.denyWarn"`, since the policy is what makes it fail the audit. Other findings have no `deniedBy` field. `confidence` is `high`, `medium`, or `low`. A `critical` match with `low` confidence has `severity` `warn`. Rule names and confidence are in [security-scan.md](security-scan.md#confidence).

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
- `disable` skips a skill whose copy is also its local source, as `nik adopt`
  records a skill with no known source, because removing the copy would delete
  the source. It names `nik remove` and exits `1`.
- The disabled state is in `niksi-lock.json`. Commit it to share it. `install`, `update`, and `list` read it. `remove` deletes a disabled entry.

## `enable`

```text
nik enable [...skills|source] [-g|-p] [-a] [-y] [--agent <id>]
```

`enable` clears the mark and restores each skill as `install` does. It reads the store or the source and checks the recorded integrity. A local source must still have the skill and match the recorded integrity, as in `install`. It does not review, scan, or check dependencies.

- Select skills and sources as in `disable`. `--all` selects every disabled skill. A skill that is already enabled prints `name: already enabled`.
- Link entries restore to their recorded agents. A link entry without recorded agents needs agents: `enable` uses `--agent`, else the remembered choice, else the detected defaults, else a prompt, and records them in the entry. Agent copies and path copies restore to their recorded agents or destination root. A selection with no link entry that lacks recorded agents selects no agents.
- If the content of an entry does not match its integrity, `enable` reports it as `install` does. The entry stays disabled. The command exits `1`.
- In project scope, `enable` checks the selected entries against the policy in `niksi.json` first, as `install` does. When an entry comes from a source that the policy doesn't allow, `enable` names each such entry, enables nothing, and exits `1`.

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
| `-a`, `--all` | `add`, `adopt`, `update`, `remove`, `disable`, `enable` | Select every skill. `disable` selects enabled skills and `enable` selects disabled skills. It does not confirm or approve anything. |
| `-y`, `--yes` | `add`, `adopt`, `install`, `update`, `remove`, `disable`, `enable`, `prune` | Accept ordinary confirmations and defaults. It cannot approve critical findings, or warn findings under `policy.denyWarn`. |
| `--dangerous-skip-critical-approval` | `add`, `adopt`, `update` | Skip approval for critical findings. Dangerous. Files and findings remain visible. |
| `--copy` | `add` | Write directories instead of links. |
| `--path <directory>` | `add` | With `--copy`, write named skill directories below a project destination root. |
| `--json` | `list`, `audit`, `outdated` | Write JSON only. |
| `--report <file>` | `update` | Write a Markdown review report. |
| `--min-release-age <days>` | `add`, `update` | Set the [cooldown](#cooldown) in whole days. Default `3`, or `minimumReleaseAge` from `niksi.json` in project scope. `0` turns it off. |
| `--source <coordinate>` | `update`, `adopt` | `update` selects the skills from one source. `adopt` compares the skills with one source. |

`-g` and `-p` cannot be combined. Passing both exits `2`. An unknown `--agent` value exits `2`.

`--dangerous-skip-critical-approval` applies only to the current invocation, including dependencies reviewed by `add`. It does not imply `--yes`, `--all`, a scope, an agent, `--copy`, or `--path`. Warn finding review and write confirmation keep their existing behavior, except that under `policy.denyWarn` warn findings gate as critical, so the flag skips them too. The flag is never saved in the lockfile or configuration and has no environment-variable equivalent. The critical findings it skipped are recorded as accepted for that content; see [security-scan.md](security-scan.md#accepted-findings).

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
| Warn finding review | Pass `--yes`. Under `policy.denyWarn`, it needs the critical finding approval instead. |
| Critical finding approval | Run in a terminal, or pass `--dangerous-skip-critical-approval` to skip approval. |

An ordinary prompt with no terminal and no replacement flag exits `2`. In `add`, `adopt`, and `update`, critical findings, and warn findings under `policy.denyWarn`, instead block the skill with exit `3` unless `--dangerous-skip-critical-approval` is provided. `install` keeps modified skills and continues when there is no terminal.

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

nik install --agent claude --yes --frozen-lockfile
```

Git 2.30 or later must be on `PATH`. `nik install` exits `0` when every enabled entry in `niksi-lock.json` is on disk with its recorded integrity and every local source still matches it. It exits `1` when a local skill's source changed since `niksi-lock.json` or no longer has the skill. Run `nik update <skill>` or `nik remove <skill>` and commit the lockfile. It also exits `1`, and installs nothing, when an entry comes from a source that the policy in `niksi.json` doesn't allow. With `--frozen-lockfile`, it also exits `1` when there is no `niksi-lock.json`, so a checkout without one fails the job. `CI` disables the update notice and its release check.

`nik add` and `nik update` also run without a terminal. `--yes` accepts warn findings, unless `niksi.json` sets `policy.denyWarn`. A critical finding exits `3` unless `--dangerous-skip-critical-approval` skips approval. `nik list --json` prints machine-readable output, with each skill's `state`: `installed`, `modified`, `missing`, or `disabled`. `nik outdated --json` lists the skills with upstream updates and exits `1` when there is one; see [`outdated`](#outdated).

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

To open a pull request for updates, write a report and use it as the body. Without `--dangerous-skip-critical-approval`, a skill with critical findings stays at its recorded revision and the command exits `3`. The same goes for a skill that the policy in `niksi.json` blocks. The report lists it under **Needs a person**, so the pull request still carries the other updates:

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

The report is written outside the repository, so `git add -A` does not commit it. A changed skill whose upstream revision is inside the [cooldown](#cooldown) waits for a later run, and the report lists it under **Not updated**. When critical findings block every update, nothing changes and the script exits `3`, so the job fails instead of hiding the findings.

## Exit codes

| code | meaning |
| --- | --- |
| `0` | Success or nothing to do. |
| `1` | A skill failed. The rest of the batch still ran. In `install` and `enable`, this includes a local source that changed since `niksi-lock.json` or no longer has the skill. In `install --frozen-lockfile`, also no lockfile. In `install` and `enable`, also an entry from a source that the policy in `niksi.json` doesn't allow, and in `add`, a source that the policy doesn't allow. Then the command writes nothing. In `adopt`, also a skill whose source the policy doesn't allow. In `audit`, also a warn finding. In `outdated`, also a skill that isn't up to date. |
| `2` | Invalid usage, an invalid `niksi.json`, or a prompt had no terminal and no flag. |
| `3` | Critical findings, or warn findings under `policy.denyWarn`, blocked at least one skill in `add`, `adopt`, or `update` without `--dangerous-skip-critical-approval`. In `update` and `outdated`, also a skill whose source the policy in `niksi.json` doesn't allow. In `audit`, a critical finding in an installed skill whose rule the lockfile entry does not accept, or a warn finding under `policy.denyWarn`. Accepted critical findings do not change the `audit` exit code. When a run has reasons for both `1` and `3`, it exits `3`. |
| `130` | Cancelled. |
