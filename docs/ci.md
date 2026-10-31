# CI

The `niksi` GitHub Action runs `nik` in a workflow, so you can restore, update, and scan skills without installing anything yourself. For other CI systems, see [commands.md](commands.md#ci).

Pick the section for what you want to do:

| you want to | action mode | section |
| --- | --- | --- |
| Have your project's skills on disk in a job, and fail when the lockfile is stale. | `install` | [Restore skills in a job](#restore-skills-in-a-job) |
| Get a pull request when a skill from a Git source has an update. | `update` | [Get pull requests for skill updates](#get-pull-requests-for-skill-updates) |
| Record the new integrity of skills that you keep in your own repository. | `update` | [Record edits to your own skills](#record-edits-to-your-own-skills) |
| Scan the skills you publish, and show a badge in your README. | `scan` | [Scan a skill repository](#scan-a-skill-repository) |

## Set up the action

Add a step that uses `osrim/niksi` and sets `mode`:

```yaml
- uses: osrim/niksi@v0.4.0
  with:
    mode: install
```

The examples on this page use the tag so they're easy to read. In your workflow, pin the action to the full commit of the release tag, and keep the tag in a comment:

```yaml
- uses: osrim/niksi@<commit of v0.4.0> # v0.4.0
```

The action downloads the `nik` binary of its own release, checks it against the release's `checksums.txt`, and puts it on `PATH`. To run another release, set `version`, for example `version: 0.3.7`.

The action runs on GitHub-hosted Linux and macOS runners, x64 or arm64. It needs `bash`, `curl`, `git`, `jq`, and `gh`, which GitHub-hosted runners include. There's no Windows build.

## Restore skills in a job

Install mode runs `nik install --project --yes` in the checkout. It restores every enabled skill in `niksi-lock.json` and fails the step when `nik` exits non-zero. Use it before a step that needs the skills, such as an agent that runs in CI.

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

The action passes `agent` to `--agent`, which sets the agents for link entries that record no agents. Without `agent`, `nik` uses the detected defaults. Link entries that record agents, agent copies, and path copies install to the destination that their lockfile entry records.

The step fails in these cases:

- A skill doesn't match its recorded integrity.
- A local skill's source changed since `niksi-lock.json`. Run `nik update <skill>` and commit the lockfile.
- A local source no longer has the skill. Run `nik remove <skill>` and commit the lockfile.

## Get pull requests for skill updates

Update mode runs `nik update --project --yes --report <file>` in the checkout and adds the report to the job summary. The report lists each skill with its old and new revision, a diff stat, and its findings. Without `source`, the action passes `--all`, which selects every skill that isn't pinned.

When `pull-request` is `true`, the default, the action then manages one pull request:

1. It commits every change in the checkout to `branch` and force-pushes it. That includes files that earlier steps of the job wrote, so run update mode before steps that change files.
2. It opens a pull request into the branch the workflow runs on, with `title` as the title and the report as the body. If a pull request from `branch` is already open, it updates that one.
3. When no file changed, it opens nothing, closes the open pull request from `branch`, and prints `Nothing to update.`

GitHub limits a pull request body to 65,536 characters. When the report is longer than 60,000, the body links to the job summary instead.

To check for updates once a week, run update mode on a schedule:

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

### Permissions and tokens

Before update mode can open a pull request, set up the repository:

1. Give the job `contents: write` to push the branch and `pull-requests: write` to open the pull request.
2. In the repository settings, under **Actions** > **General**, turn on **Allow GitHub Actions to create and approve pull requests**.

The action pushes and calls `gh` with `token`, which defaults to `GITHUB_TOKEN`. It replaces the credentials that `actions/checkout` stores, so `persist-credentials: false` works.

GitHub starts no workflows for a pull request that `GITHUB_TOKEN` opens, so checks don't run on it. The pull request body says so and tells you to close and reopen the pull request to start them. To get checks without that step, set `token` to a GitHub App token or a fine-grained token with the same permissions.

`nik update` reads skill files and never runs them, so the job runs no upstream skill code while it holds the token.

### Critical findings

A critical finding needs a person's approval, and update mode never skips it. The blocked skill stays at its recorded revision. The report lists it under **Needs a person**, with the `nik update` command to run in a terminal. The action still opens the pull request with the other updates, then fails the step with exit `3`.

When `nik update` exits `1` or `2`, the action opens no pull request and fails the step.

## Record edits to your own skills

If you keep your own skills in the repository, such as in `skills/`, editing one changes its integrity. Until `niksi-lock.json` records the new integrity, `nik install` fails for that skill. Update mode with `source: local` records it for you after each push. It leaves skills from Git sources at their recorded revision.

This workflow has two jobs. On a pull request, the `review` job sets `pull-request` to `false`: it shows the report in the job summary, pushes nothing, and needs no write permission. After a push to `main`, the `pull-request` job opens the lockfile pull request.

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

The `concurrency` group stops two runs on `main` from force-pushing the branch at the same time. Merging the lockfile pull request starts the workflow again. That run finds nothing to update and opens nothing.

The `pull-request` job needs the same [permissions and repository setting](#permissions-and-tokens) as any update mode job.

## Scan a skill repository

Scan mode checks the skills you publish the way `nik add` checks them for your users. It copies every skill under `path` into a temporary project with `nik add --all --copy`, then scans the copies with `nik audit`. It fails the step on a critical finding. Warn and info findings don't fail it.

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

The job summary shows the number of scanned skills and the findings by severity. The job log shows every finding. [security-scan.md](security-scan.md) explains each rule.

`nik add` runs with `--dangerous-skip-critical-approval`, so it writes skills with critical findings into the temporary project, and `nik audit` can count them. That `nik add` records the findings as accepted in the temporary lockfile, so they do not change the `nik audit` exit code. The step counts critical findings in the `nik audit --json` output instead, and fails with exit `3` when there is one. Nothing outside the temporary project changes.

### Add the badge

Scan mode writes a Markdown badge to the job summary and to the `badge` output. The badge shows the status of the scan workflow on the default branch and links to `niksi`:

```markdown
[![niksi scan](https://github.com/owner/skills/actions/workflows/skill-scan.yml/badge.svg)](https://github.com/osrim/niksi)
```

Copy it into your README. The badge shows the status of the whole workflow, so keep the scan in a workflow of its own.

## Inputs

| input | action mode | default | meaning |
| --- | --- | --- | --- |
| `mode` | all | | `install`, `update`, or `scan`. Required. |
| `version` | all | the action's release | The `niksi` version to run. |
| `agent` | `install` | | Agents for link entries that record no agents, separated by commas. |
| `source` | `update` | | Update only the skills from this source. Takes the coordinates that `nik update --source` takes, including `local`. |
| `pull-request` | `update` | `true` | Open or update a pull request. `false` writes only the report. |
| `branch` | `update` | `niksi-update` | The pull request branch. It must differ from the branch the workflow runs on. |
| `title` | `update` | `chore: update skills` | The pull request title and commit message. |
| `token` | `update` | `GITHUB_TOKEN` | The token that pushes the branch and calls `gh`. |
| `path` | `scan` | `.` | The directory to scan. |

## Outputs

| output | action mode | value |
| --- | --- | --- |
| `report` | `update` | Path of the Markdown report. |
| `pull-request-url` | `update` | URL of the opened or updated pull request. Empty when nothing changed. |
| `badge` | `scan` | Markdown for the badge. |

## Exit codes

The step exits with the code of `nik`, as listed in [commands.md](commands.md#exit-codes), except where this table says otherwise.

| code | install | update | scan |
| --- | --- | --- | --- |
| `0` | Every enabled skill is on disk with its recorded integrity. | Every selected skill is up to date or updated. The pull request is open, updated, or closed. | No critical finding. Warn findings pass. |
| `1` | A skill failed to restore. | A skill failed. No pull request. | `path` isn't a directory, `nik add` failed, or a skill couldn't be read. |
| `2` | Invalid input. | Invalid input. Also when `pull-request` is `true` and the workflow doesn't run on a branch, such as on `pull_request`, or when `branch` is the branch it runs on. | Invalid input. |
| `3` | | Critical findings blocked a skill. The pull request still carries the other updates. | A skill has a critical finding. |

An unknown `mode` exits `2`. An invalid `version`, a failed download or checksum, or an unsupported runner exits `1`.
