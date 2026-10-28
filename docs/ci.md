# CI

The `niksi` GitHub Action runs `nik` in a workflow. It has three modes:

| mode | runs | for |
| --- | --- | --- |
| `install` | `nik install` | A project whose jobs need its skills. |
| `update` | `nik update`, then opens a pull request | A project that keeps its skills up to date. |
| `scan` | `nik add` into a temporary project, then `nik audit` | A repository that publishes skills. |

For other CI systems, see [commands.md](commands.md#ci).

## Set up the action

Add a step that uses `osrim/niksi` with a `mode`:

```yaml
- uses: osrim/niksi@v0.4.0
  with:
    mode: install
```

The examples on this page use the tag for readability. Pin the action to the full commit of the release tag, and keep the tag in a comment.

The action downloads the `nik` binary of the same release, checks it against the release's `checksums.txt`, and puts it on `PATH`. To run another release, set `version`, for example `version: 0.3.7`.

The action runs on GitHub-hosted Linux and macOS runners, x64 or arm64. It needs `bash`, `curl`, `git`, `jq`, and `gh`, which GitHub-hosted runners include. There is no Windows build.

## Install mode

Install mode runs `nik install --project --yes` in the checkout. It restores every enabled skill in `niksi-lock.json` and fails the step when `nik` exits non-zero.

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - uses: osrim/niksi@v0.4.0
        with:
          mode: install
          agent: claude
```

`agent` is passed to `--agent`. It sets the agents for link entries. Without it, `nik` uses the detected defaults. Agent copies and path copies install to the destination their lockfile entry records.

The step fails when a skill doesn't match its recorded integrity, or when a local skill's source changed since `niksi-lock.json` or no longer has the skill. Run `nik update <skill>` or `nik remove <skill>` and commit the lockfile.

## Update mode

Update mode runs `nik update --project --yes --report <file>` in the checkout and adds the report to the job summary. With `source`, it passes `--source` and updates the skills from that source. Without `source`, it passes `--all` and updates every skill that is not pinned.

When `pull-request` is `true`, the default, the action then opens a pull request:

1. It commits every change in the checkout to `branch` and force-pushes it. That includes files that earlier steps of the job wrote, so run update mode before steps that change files.
2. It opens a pull request into the branch the workflow runs on, with `title` as the title and the report as the body. If a pull request from `branch` is open, it updates that one.
3. When no file changed, it opens nothing and closes the open pull request from `branch`. It prints `Nothing to update.`

A report longer than 60,000 characters doesn't fit in a pull request body. The body then links to the job summary.

### Keep Git sources up to date

Run update mode on a schedule:

```yaml
name: skill updates

on:
  schedule:
    - cron: "0 6 * * 1"
  workflow_dispatch:

permissions: {}

jobs:
  update:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - uses: osrim/niksi@v0.4.0
        with:
          mode: update
```

### Record local skill edits

A project that keeps its own skills in the repository, such as in `skills/`, can record their new integrity after each push. `source: local` leaves skills from Git sources at their recorded revision. On a pull request, the `review` job sets `pull-request` to `false`, so it shows the report in the summary, pushes nothing, and needs no write permission:

```yaml
name: skills lockfile

on:
  push:
    branches: [main]
    paths: ["skills/**", "niksi-lock.json"]
  pull_request:
    paths: ["skills/**", "niksi-lock.json"]

permissions: {}

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  review:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - uses: osrim/niksi@v0.4.0
        with:
          mode: update
          source: local
          pull-request: false

  pull-request:
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - uses: osrim/niksi@v0.4.0
        with:
          mode: update
          source: local
```

The `concurrency` group stops two runs on `main` from force-pushing the branch at the same time.

Merging the pull request starts the workflow again. That run finds nothing to update and opens nothing.

### Permissions and tokens

The job needs `contents: write` to push the branch and `pull-requests: write` to open the pull request. In the repository settings, under **Actions** > **General**, turn on **Allow GitHub Actions to create and approve pull requests**.

The action pushes and calls `gh` with `token`, which defaults to `GITHUB_TOKEN`. It replaces the credentials that `actions/checkout` stores, so `persist-credentials: false` works. GitHub starts no workflows for a pull request that `GITHUB_TOKEN` opens, so checks don't run on it. The pull request body says so, and tells you to close and reopen the pull request to run them. To avoid that, set `token` to a GitHub App token or a fine-grained token with the same permissions.

`nik update` reads skill files and never runs them, so the job runs no upstream skill code while it holds the token.

### Critical findings

A critical finding needs a person's approval. Update mode never skips it. The blocked skill stays at its recorded revision, and the report lists it under **Needs a person** with the `nik update` command to run in a terminal. The action still opens the pull request with the other updates, then fails the step with exit `3`.

When `nik update` exits `1` or `2`, the action opens no pull request and fails the step.

## Scan mode

Scan mode checks a repository that publishes skills, as a consumer would see them. It copies every skill under `path` into a temporary project with `nik add --all --copy`, then scans the copies with `nik audit`. It fails the step on a critical finding. Warn and info findings don't fail it.

```yaml
name: skill scan

on:
  push:
    branches: [main]
  pull_request:

permissions: {}

jobs:
  scan:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - uses: osrim/niksi@v0.4.0
        with:
          mode: scan
```

The job summary shows the number of scanned skills and findings by severity, and the job log shows every finding. Each rule is in [security-scan.md](security-scan.md).

`nik add` runs with `--dangerous-skip-critical-approval`, so it writes skills with critical findings into the temporary project, and `nik audit` can count them. Nothing outside the temporary project changes.

### Add the badge

Scan mode writes a Markdown badge to the job summary and to the `badge` output. The badge shows the status of the scan workflow on the default branch and links to `niksi`:

```markdown
[![niksi scan](https://github.com/owner/skills/actions/workflows/skill-scan.yml/badge.svg)](https://github.com/osrim/niksi)
```

Copy it into your README. The badge reflects the whole workflow, so keep the scan in a workflow of its own.

## Inputs

| input | mode | default | meaning |
| --- | --- | --- | --- |
| `mode` | all | | `install`, `update`, or `scan`. Required. |
| `version` | all | the action's release | The `niksi` version to run. |
| `agent` | `install` | | Agents for link entries, separated by commas. |
| `source` | `update` | | Update only the skills from this source. Takes the coordinates that `nik update --source` takes, including `local`. |
| `pull-request` | `update` | `true` | Open or update a pull request. `false` writes only the report. |
| `branch` | `update` | `niksi-update` | The pull request branch. |
| `title` | `update` | `chore: update skills` | The pull request title and commit message. |
| `token` | `update` | `GITHUB_TOKEN` | The token that pushes the branch and calls `gh`. |
| `path` | `scan` | `.` | The directory to scan. |

## Outputs

| output | mode | value |
| --- | --- | --- |
| `report` | `update` | Path of the Markdown report. |
| `pull-request-url` | `update` | URL of the opened or updated pull request. Empty when nothing changed. |
| `badge` | `scan` | Markdown for the badge. |

## Exit codes

The step exits with the code of `nik`, as listed in [commands.md](commands.md#exit-codes), except where this table says otherwise.

| code | install | update | scan |
| --- | --- | --- | --- |
| `0` | Every enabled skill is on disk with its recorded integrity. | Every selected skill is up to date or updated. The pull request is open, updated, or closed. | No critical finding. Warn findings pass. |
| `1` | A skill failed to restore. | A skill failed. No pull request. | `path` is not a directory, `nik add` failed, or a skill couldn't be read. |
| `2` | Invalid input. | Invalid input. Also when `pull-request` is `true` and the workflow doesn't run on a branch, such as on `pull_request`. | Invalid input. |
| `3` | | Critical findings blocked a skill. The pull request still carries the other updates. | A skill has a critical finding. |

An unknown `mode` exits `2`. An invalid `version`, a failed download or checksum, or an unsupported runner exits `1`.
