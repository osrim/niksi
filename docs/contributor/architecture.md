# Architecture

For contributors. `niksi` is a Bun workspace with one package in `cli/`. Terms follow [CONTEXT.md](../../CONTEXT.md).

## Layers

```text
index.ts -> commands -> ui -> core
                    \------> core
```

- `index.ts` registers commands, renders root help, starts the update check for every run, and turns argument and top-level errors into exit codes. It answers the hidden `__complete-skills` helper before it parses arguments, so the helper never starts the update check.
- `commands/` owns each command's policy and sequence. A prompt or spinner used by one command only may live in that command.
- `ui/` holds terminal behavior shared by commands: prompts, the review gate, reports, styling, per-skill progress, and exit status for UI failures.
- `core/` implements behavior with no terminal input, terminal output, or process exit.

Imports point downward only. Commands may import `ui/` and `core/`. UI may import `core/`. Nothing imports `commands/` or `index.ts`.

## Modules

```text
cli/src/
  index.ts
  test-env.ts        environment capture and restore, tests only
  test-cli.ts        CLI runners and fixtures, tests only
  test-output.ts     output capture and fake terminal, tests only
  test-color.ts      fresh-process probe for color output, tests only
  commands/          add, install, update, remove, list, audit, disable, enable, prune, completion
  ui/                prompts, review, gate, decisions, pager, reports, help, status, destination choices, legacy migration notice
  core/
    completion/      completion spec from the registered commands, bash, zsh, and fish scripts, skill names for the helper
    config.ts        remembered scope and agent choices
    paths.ts         XDG roots, project root, lockfile path
    suggest.ts       command typo suggestions
    update-check.ts  latest release version check
    update-report.ts Markdown report of an update run
    usage.ts         usage error type
    source/          coordinates, Git and local sources, revisions, upstream
    skill/           files, frontmatter, integrity, dependency mentions, Markdown map
    scan/            scan rules, findings, and per-rule fixtures
    install/         scope, agents, store, target checks, links, path copies, replacement, destination, lockfile, ski layout migration
```

`core/source/` and `core/install/` are siblings. Runtime imports point from `install/` to `source/` only. Source adapters may type-import installed skill data. Commands and UI combine the two.

## GitHub Action

The action is `action.yml` at the repository root. Its steps run the Bash scripts in `action/`, outside the Bun workspace:

- `setup.sh` downloads the `nik` binary, checks it against `checksums.txt`, and puts it on `PATH`. It takes the `version` input, else the version in `cli/package.json` at the action's ref.
- `install.sh`, `update.sh`, and `scan.sh` each run one action mode. They call `nik`, `git`, `gh`, and `jq`, and never import from `cli/`.

`cli/src/commands/github-action.integration.test.ts` runs each mode script against `nik` from source, local Git repositories, and a stub `gh`. It doesn't test `setup.sh`, because tests don't use the network. The `action` job in `checks.yml` runs the action end to end on pull requests. The user-facing contract is in [ci.md](../ci.md).

## Write path

Every command that writes goes through `ui/flow.ts`, which exports `fetchSkillFiles`, `confirm`, `restoreSkill`, and `land`.

| command | uses |
| --- | --- |
| `add` | `fetchSkillFiles` through `ui/review.ts`, `confirm`, `land` |
| `update` | `land` |
| `remove` | `confirm`, `land` |
| `install` | `restoreSkill`, `land` |
| `disable` | `confirm`, `land` |
| `enable` | `restoreSkill`, `land` |
| `prune` | `confirm`, `land` |

`restoreSkill` restores one lockfile entry. It reads the destination from the recorded placement, takes the files from the store or the source, checks the integrity, and writes. For a local source it first compares the source directory with the recorded integrity, so a stored copy cannot hide a source that changed or no longer has the skill. `land` applies each item, reports failures, writes the supplied lockfile after the batch, and hides managed links from Git. A failed item does not stop the batch. The command exits `1`. When a command supplies a lockfile, the written lockfile matches what is on disk. `add`, `remove`, `disable`, and `enable` always supply a lockfile. `update` supplies one only when a selected revision moved or a selected file update was approved. `install` supplies none because it restores the recorded state without changing it, so a failed restore leaves the recorded entry with no files on disk. `prune` supplies none because it deletes only unrecorded store entries and never changes a lockfile.

`core/install/lockfile.ts` splits a lockfile into enabled and disabled entries. Commands that select a batch read that split. `list` shows every entry and reads the `disabled` flag per row.

`core/install/lockfile.ts` derives one `Placement` from each entry: link, agent copy, or path copy. A link placement carries the recorded agents, which are empty when the entry records none, as in a version 1 lockfile. For a link, `applySkill` records the union of the recorded agents and the agents linked on disk after the write. `disable` and `enable` fill in the agents of a link entry that records none through `recordLinkAgents`. `core/install/destination.ts` switches on that placement.

`core/install/lockfile.ts` reads lockfile versions 1 and 2, each with its own entry rules, and always writes version 2.

`core/install/destination.ts` gives commands the installed location, filesystem path, state, apply destination, and removal operation. Commands do not read `agents` or `copyPath` to decide placement.

`core/install/apply.ts` refuses unmanaged targets and ensures that a store entry exists. It then applies the destination's placement.

Links use `core/install/link.ts`. Path copies use `core/install/path-copy.ts`. Both use the path probes and containment check in `core/install/target.ts`.

A path copy does not create a canonical copy or agent link. The store is a cache. Installed skills do not depend on it.

## Recovery boundary

Canonical copies, agent copies, and path copies are written by `replaceDir` in `core/install/replace.ts`. `link.ts` and `path-copy.ts` resolve the directory and refuse unmanaged or unsafe targets first.

`replaceDir` writes the new files into a work directory beside the target, so every rename stays on one filesystem. It then moves the old directory into the work directory and moves the new one into place.

- A failure while the files are written leaves the old directory untouched.
- A failure while the new directory is moved into place moves the old one back. If that also fails, the error names the work directory that holds the old files.
- A failed new install leaves no directory at the target.
- When the work directory cannot be removed after a replacement, the replacement still counts. `applySkill` returns the path, and `land` reports it as a warning. When a later placement of the same skill fails, `applySkill` throws a `PlacementError` that carries the paths, and `land` still reports them.

The guarantee covers one directory. `applySkill` records the new integrity only after every placement of the skill is written. When a later placement fails, earlier placements keep the new files and the lockfile entry keeps the old integrity. `land` continues with the next item and writes the lockfile. Links, the store, and the lockfile are not part of this guarantee. Neither are crash recovery and concurrent writers.

## Review gate

`add` reviews new skills through `reviewNewSkills` in `ui/review.ts`. It fetches the selected skills and passes them through the gate. It then offers the dependencies that the approved skills mention, and passes accepted dependencies through the gate, until nothing new is mentioned. It returns the approved skills and the names of declined and blocked skills. `add` keeps selection, destination policy, the write confirmation, and `land`.

Each mention is offered at most once per run. A skill that the current scope
records is never offered. An enabled skill in the other scope is skipped only
when `lackingAgents` finds a link or agent copy in every selected agent directory.
`add` passes its selected directories through `ReviewRequest`. `update` resolves
each skill's destination with `updateDestination`, so dependencies shared by
skills with different destinations are checked separately. Path copies do not
provide other-scope agent availability, and path-copy exports do not use it.
When the other scope satisfies a dependency, the report names that scope. An
unreadable lockfile in the other scope prints a warning, and the check ignores
that scope. A declined or blocked dependency does not remove its approved parent.
Dependencies are offered only in a terminal without `yes`. Otherwise they are
reported with the `nik add` command that adds them.

Review questions and dependency offers go through a `Decisions` object from `ui/decisions.ts`. `clackDecisions` asks with Clack. Tests pass scripted decisions. Whether to ask, and what an answer means, stays in the gate and the review module.

New or changed files pass through `ui/gate.ts`. The gate takes a `ReviewOptions` object with `yes` and `dangerousSkipCriticalApproval`. It lists files, runs the scan, shows findings, and returns `pass`, `declined`, or `blocked`. `reviewSkills` also returns the findings of each skill, which `update` passes to its report. Only `blocked`, a critical finding without a terminal or the dangerous flag, sets exit code `3`.

`add` and `update` ask their write confirmation through `confirmWrite` in `ui/gate.ts`, not `confirm`. The gate questions and `confirmWrite` offer `Read files…`, which passes the reviewed skills to `ui/pager.ts`. The pager module builds the session text from pure helpers and pipes it to the pager.

`dangerousSkipCriticalApproval` skips critical approval after findings are printed. It leaves warn finding review controlled by `yes`. Commands pass these options through every review path, including dependencies offered by `add`. The options apply only to the current invocation; placement and persistence code do not use the dangerous flag.

`add` and `update` pass `criticalRules` of each approved skill's findings to `applySkill` as `acceptedRules`, whether a person approved them or the dangerous flag skipped approval. `applySkill` records them in the entry's `review`. A write without `acceptedRules`, such as an extension to another agent or a moved revision, keeps the recorded `review` only when the integrity is unchanged.

- `add` reaches the gate for every new skill and for dependencies it offers to install.
- `update` reaches the gate only when skill files changed. A moved revision with identical files skips it. Missing dependencies are reported, not installed.
- `install` never reaches the gate. Every lockfile entry records content that already passed it, and the integrity check proves the files still match.
- `enable` never reaches the gate. It restores a disabled entry through `restoreSkill`, the same path as `install`.
- `audit` never reaches the gate. It calls `runScanners` on the installed files, marks the critical findings that the entry's `review.acceptedRules` accepts with `markAccepted` when `integrityOf` the files equals the entry's `integrity`, and prints the findings with `logFindings`. It asks nothing and writes nothing.

An approval covers one source, path, integrity, and scope. Adding approved content to another agent does not reopen the gate.
