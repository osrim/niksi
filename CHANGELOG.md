# Changelog

What each release changes for people who run `nik` or the niksi action. To add
an entry, run `/start-release X.Y.Z`.

## [0.5.0-alpha.3](https://github.com/osrim/niksi/releases/tag/v0.5.0-alpha.3) (2026-11-08)

`nik adopt` records skills you installed without `niksi`, a committed `niksi.json` sets which sources a project's skills may come from, and `nik update` waits 3 days before it takes a new release on its own.

### Upgrading

- `nik update --all`, `nik update --source`, and the action's update mode now leave a skill at its recorded revision while the upstream revision that changes its files is younger than 3 days, and list it under **Not updated** in the report. Set `"minimumReleaseAge": 0` in `niksi.json`, or pass `--min-release-age 0`, to take every release at once. (#83)

### Highlights

**Bring existing skills under `niksi`.** `nik adopt` finds skills in your agents' skills directories that `niksi-lock.json` doesn't record, such as ones you copied by hand or installed with `gh skill` or `npx skills`, and records them after the usual file review and scan. It finds the source from `--source`, the `gh skill` metadata in `SKILL.md`, or the `npx skills` lockfile, and records the commit whose files match. A skill with no known source, or with edited files, is recorded as a local source and keeps its files. (#80)

**Set a project policy.** Commit a `niksi.json` next to `niksi-lock.json` to list the GitHub organizations and Git repositories that skills may come from. `nik add` refuses a source the policy doesn't allow before it downloads anything, `nik update` keeps a skill from one at its recorded revision and exits `3`, and `nik install` and `nik enable` install nothing while an entry breaks the policy. Set `policy.denyWarn` to make a warn finding need approval in a terminal, like a critical one. (#84, #85)

**Fresh releases wait.** A release pushed from a hijacked maintainer account no longer reaches `nik update --all --yes` or the action's pull request the same day. Naming a skill, as in `nik update tdd`, or picking it in the picker updates it now. Set the number of days with `minimumReleaseAge` in `niksi.json` or `--min-release-age`. (#83, #84)

### Changes

- `nik add` installs a release younger than the cooldown but prints a warning with its age, such as `v2.0.0 is 1 day old, inside the 3-day cooldown.` (#83)
- The `nik update` picker shows the age of each update. (#83)
- `nik disable` refuses a skill that `nik adopt` recorded as its own local source, since removing its files would delete the source, and names `nik remove` instead. (#80)

https://github.com/osrim/niksi/releases/tag/v0.5.0-alpha.2) (2026-11-07)

`nik audit` now tells a critical finding you approved apart from one nobody approved, and `nik install` links each skill to the agents it was added for.

### Upgrading

- **Action required** if you install alphas from npm: alphas no longer reach npm, so `niksi@next` stays on 0.5.0-alpha.1. Run `npm uninstall -g niksi`, then `brew install osrim/tap/niksi-alpha`. (#74)
- The next command that writes `niksi-lock.json` rewrites it as lockfile version 2, which 0.5.0-alpha.1 and older reject with `unsupported lockfile version 2`. Upgrade `nik` on every machine and CI job that reads the file, including the action's `version` input if you pin it. (#75)
- `nik audit` exits `0` instead of `3` when every critical finding in a skill was approved by `nik add` or `nik update` for the installed content, including findings skipped with `--dangerous-skip-critical-approval`. (#75)
- `nik install --agent` and the action's `agent` input now apply only to link entries that record no agents. Other link entries install to the agents in `niksi-lock.json`. (#75)
- A skill from a Git source with a file name such as `café.txt`, or one with a tab or quote, gets a new integrity the next time `nik add` or `nik update` writes it, so expect its `niksi-lock.json` entry to change. (#75)

### Highlights

**Approved findings stay approved.** When you approve a critical finding in `nik add` or `nik update`, or skip it with `--dangerous-skip-critical-approval`, `niksi-lock.json` records its rule under `review.acceptedRules`. `nik audit` still prints the finding, marks it `(accepted)`, and counts it as `N accepted finding(s)`, but it no longer fails the run. The approval holds only while the files on disk match the recorded integrity, so an edited skill gets no accepted findings and a notice that it is modified. Review `acceptedRules` in the lockfile diff like any other dependency change.

**Teammates get the same agents.** `nik add` records the agents of a linked skill in `niksi-lock.json`, so `nik install` and `nik enable` on another machine link it to those agents instead of whatever that machine detects or picks.

### Changes

- `nik audit --json` gives each accepted finding `accepted: true`. (#75)
- `nik audit` scans every agent copy of a skill, not only the first one it finds. (#75)
- `docs/lockfile.md` describes every `niksi-lock.json` field, the integrity algorithm, and the exact written form, so other tools can read and write the file. (#76)

### Fixes

- A skill from a Git source now installs a file such as `café.txt` under its real name. (#75)
