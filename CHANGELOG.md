# Changelog

What each release changes for people who run `nik` or the niksi action. To add
an entry, run `/start-release X.Y.Z`.

## [0.5.0-alpha.2](https://github.com/osrim/niksi/releases/tag/v0.5.0-alpha.2) (2026-11-07)

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
