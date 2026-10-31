---
name: start-release
description: Draft the CHANGELOG.md entry for the version you choose, then give the steps to ship it.
argument-hint: X.Y.Z or X.Y.Z-alpha.N
disable-model-invocation: true
---

Write the `CHANGELOG.md` entry for the version in the argument. The reader
runs `nik` on their machine or the niksi action in CI, and skims: keep what
they would notice, drop the rest. Without a version in the argument, ask for
one and stop.

The version scheme and alphas are in `docs/releasing.md`.

## Steps

1. Check that the repository is on `main`, up to date with `origin`, with a
   clean working tree. Otherwise, say what's off and stop.
2. List the commits since the previous release:
   `git log --format='%h %an %s' <previous>..HEAD`. For an alpha, the
   previous release is the newest tag, `git describe --tags --abbrev=0`. For a
   stable version, it is the newest stable tag,
   `git describe --tags --abbrev=0 --exclude='*-*'`: stable users never saw
   the alphas, so their entry covers the alphas' commits too.
3. Read each commit: `gh pr view <n> --json body` for a `(#n)` title,
   `git show --stat` otherwise. For a `renovate[bot]` commit, read only the
   title and `git show --stat`: its PR body quotes upstream release notes,
   which are not ours to repeat. Done when every commit sits in a bullet, is
   folded into another bullet, or is on the dropped list (`chore: release`
   commits, CI, tests, refactors, tooling, contributor docs, dependency bumps
   with no visible effect).
4. Check the range for upgrade changes: commit types with `!`, and
   `git diff --stat <previous>..HEAD -- action.yml docs/commands.md docs/configuration.md docs/ci.md docs/security-scan.md`.
   A change that makes an existing setup behave differently (a command, flag,
   exit code, environment variable, lockfile field, or action input) is an
   Upgrading bullet, even under a `chore:` title. If one breaks a setup and
   the version bumps only the patch, open the reply with that.
5. Insert the entry above the newest entry in `CHANGELOG.md`, under the
   heading `## [X.Y.Z](https://github.com/osrim/niksi/releases/tag/vX.Y.Z) (YYYY-MM-DD)`
   with today's date. Leave it uncommitted: `bun run release` commits it.
6. Reply with the entry, the dropped commits one per line, and these steps
   with the version filled in:
   1. Read the entry in `git diff CHANGELOG.md`, not in this reply: the file
      is what ships as the release notes. Edit it or ask the agent to.
   2. From `cli/`, run `bun run release X.Y.Z`. bumpp writes the version to
      `cli/package.json`, commits it with `CHANGELOG.md`, tags `vX.Y.Z`, and
      pushes.
   3. Run `gh run watch` and pick the release run. For a stable version,
      approve the staged npm packages as "Approving the npm packages" in
      `docs/releasing.md` describes. The version is out when the run passes
      and `brew upgrade` or `npx niksi --version` shows `X.Y.Z`.
   4. If the run fails, follow "When a release fails" in `docs/releasing.md`.

## Format

Sections in this order, each only when it has content:

- A lead of one or two sentences, with no heading.
- `### Upgrading`: what an existing setup must change, or will see change.
  An item that needs action comes first, starts with **Action required**, and
  gives the exact command, flag, or input.
- `### Highlights`: up to three changes to how someone uses `nik`, a short
  paragraph each.
- `### Changes`
- `### Fixes`

A bullet is one sentence on what the reader can now do or see, in the words
of `CONTEXT.md`, with commands, flags, files, and action inputs in code spans
and `(#n)` at the end. Commit types, issue ids, source file names, and
implementation detail stay out. Fold PRs that extend one feature, such as
new scan rules, into one bullet that ends with every PR number.

Commit: `feat(cli): flag credential reads, shipped secrets, and URL passwords (#63)`
Bullet: `` `nik add`, `nik update`, and `nik audit` now flag a skill that reads credentials, ships a secret, or puts a password in a URL. (#63) ``

Commit: `fix(cli): print spinner steps without cursor codes when piped (#50)`
Bullet: `` `nik` output piped to a file or a CI log no longer holds cursor codes. (#50) ``
