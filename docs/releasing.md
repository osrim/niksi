# Releasing

For maintainers. A release is a tag, a GitHub Release with four binaries, a Homebrew formula, and five npm packages.

## Version scheme

`niksi` is 0.x. A breaking change bumps the minor version. Anything else bumps the patch version. Move to 1.0 when a breaking minor bump would annoy users.

The version lives in `cli/package.json`. The tag is the version with a `v` prefix. `release.yml` fails when they differ.

## Release command

From `cli/`, on `main`, with a clean tree:

```sh
bun run release
```

`bumpp` asks for the bump, writes `cli/package.json`, commits `chore: release vX.Y.Z`, tags `vX.Y.Z`, and pushes. The tag push starts `release.yml`.

`bumpp` is a pinned dev dependency. Do not run `bunx bumpp`. `bunx` fetches the latest version and its dependencies at release time and runs them on the machine that holds push rights. The pin, the lockfile hash, and the three-day `minimumReleaseAge` in `bunfig.toml` cover `bumpp` like any other dependency.

After the run stages the npm packages, approve them. See "Approving the npm packages" below.

## What release.yml does

The `build` job is a matrix. Each matrix job compiles one binary on a runner that can run it:

| binary | runner |
| --- | --- |
| `darwin-arm64` | `macos-latest` |
| `darwin-x64` | `macos-latest`, smoke test under Rosetta |
| `linux-x64` | `ubuntu-latest` |
| `linux-arm64` | `ubuntu-24.04-arm` |

Each matrix job checks `nik --version`, runs `nik add` and `nik install` against a local skill, and uploads `niksi-<os>-<arch>.tar.gz` as a workflow artifact. The `linux-x64` job also runs the test suite. The matrix holds no secrets, so it is the only place that installs dependencies and runs third-party code.

The `release` job runs on `ubuntu-latest` after all matrix jobs pass. It holds the release token, the tap deploy key, and the npm OIDC token, so it never runs `bun install`. The two scripts it runs import only builtins and `package.json`.

1. Checks that `cli/package.json` matches the tag.
2. Downloads the tarballs and writes `checksums.txt`.
3. Uploads them to a GitHub Release. Notes are generated from merged PR titles.
4. Renders `Formula/niksi.rb` with `cli/scripts/brew-formula.ts` and pushes it to `osrim/homebrew-tap` with the `TAP_DEPLOY_KEY` secret.
5. Renders the npm packages with `cli/scripts/npm-packages.ts`, unpacks one binary into each platform package, and stages them with `npm stage publish`.

Step 4 runs after the Release. The asset must be public before the formula points at it. From then on `brew install osrim/tap/niksi` and `brew upgrade` serve the new version.

Step 5 stages `niksi` and the four platform packages `@osrim/niksi-<os>-<arch>`. Installs do not see a staged version until a maintainer approves it. `niksi` holds `bin/nik.js`, a node shim that runs the binary from the platform package npm installed, and pins the four as `optionalDependencies` at the release version.

The step skips a package that the registry already published at that version. It cannot see staged versions, because the OIDC token can only stage. There is no npm token. The registry trusts `release.yml` through OIDC and records provenance on the package page. The npm CLI does the publish, not `bun publish`, because OIDC lives in npm's client.

The GitHub Release stays the source of truth. The update notice in `nik` reads it, then names `brew`, `npm`, or the download page depending on where the running binary lives.

## Approving the npm packages

The trusted publisher can only stage. Approval is the human step that a stolen workflow, action, or GitHub session cannot perform. It needs a 2FA code per package.

```sh
npm login
npm stage list                     # one stage id per package
npm stage download <stage-id>      # optional: inspect a tarball
npm stage approve <stage-id>       # the four @osrim/niksi-* first, then niksi
npm logout
```

Approve the platform packages before `niksi`, so `niksi` never resolves before its binaries exist. `npm stage reject <stage-id>` drops a staged version and spends the version number. Log out afterwards. The 2025 worms stole live sessions from `~/.npmrc`.

Then check from an empty directory: `npx niksi --version`.

To check the build and the formula locally, use a fake `checksums.txt` with four different hashes. `brew style` only lints a formula inside a tap. Render into the local tap checkout, lint, then reset the tap:

```sh
bun run build && ./dist/nik --version
printf '%064d  niksi-darwin-arm64.tar.gz\n%064d  niksi-darwin-x64.tar.gz\n%064d  niksi-linux-arm64.tar.gz\n%064d  niksi-linux-x64.tar.gz\n' 1 2 3 4 > dist/checksums.txt
bun scripts/brew-formula.ts 0.1.0 dist/checksums.txt > "$(brew --repo osrim/tap)/Formula/niksi.rb"
brew style osrim/tap/niksi && git -C "$(brew --repo osrim/tap)" checkout Formula/niksi.rb
```

To check the npm packages locally, stage them with the binary you just built. Then install the two that fit this machine into an empty directory. `npm pack --dry-run` on `dist/npm/niksi` must list only `LICENSE`, `README.md`, `bin/nik.js`, and `package.json`.

```sh
platform=$(./dist/nik --version | cut -d' ' -f2)   # darwin-arm64, linux-x64, ...
bun scripts/npm-packages.ts 0.1.0 dist/npm
cp dist/nik "dist/npm/niksi-$platform/nik"
npm pack --dry-run dist/npm/niksi
mkdir -p /tmp/niksi-npm && cd /tmp/niksi-npm && npm init -y > /dev/null
npm install "$OLDPWD/dist/npm/niksi" "$OLDPWD/dist/npm/niksi-$platform"
./node_modules/.bin/nik --version
```

## npm setup, once

The registry only accepts a trusted publisher on a package that already exists, so a maintainer first published each of the five by hand.

1. `npm login`. Run `bun scripts/npm-packages.ts 0.0.0 dist/npm`, then `npm publish --access public` in each directory under `dist/npm`. At `0.0.0` the platform packages hold no binary. Never reuse a version. `0.0.0` stays on the registry.
2. On [npmjs.com](https://www.npmjs.com), for each package, Settings:
   - Trusted Publisher: GitHub Actions, owner `osrim`, repository `niksi`, workflow `release.yml`, environment empty. Leave "Allow `npm publish`" unticked. The workflow only needs staging, which is always allowed.
   - Publishing access: "Require two-factor authentication and disallow bypass 2fa tokens".
3. `npm logout`. Never create a granular access token for these packages. Use a passkey or security key for npm 2FA, not an authenticator app. The 2025 phishing sites relayed one-time codes.

After that, `release.yml` stages every release and you approve it. Provenance appears on each package page.

## Supported platforms

macOS on Apple silicon and Intel. Linux on x64 and arm64 with glibc 2.17 or newer. The x64 binaries are Bun `baseline` builds, so they run without AVX2 and under Rosetta. Alpine and other musl distributions are not supported. Bun has `-musl` targets when that changes.

## Prereleases

None before 1.0. When one is needed, choose a `-beta.N` version in `bumpp`. A tag with `-` becomes a GitHub prerelease and the tap step is skipped, so `brew` users never see it. npm stages it under the `next` dist-tag, so `npm install -g niksi` never picks it.

## When a release fails

- Never reuse a version. A version that reached the tap or the registry is on users' machines. npm refuses a version it saw before, even after `npm unpublish`.
- Runner or network failure: re-run from the Actions tab with `workflow_dispatch` and the tag as input. Existing assets are replaced.
- Failure before the tap step, fix needed in code: delete the tag and the Release, merge the fix on `main`, then tag again by hand. `cli/package.json` already holds `X.Y.Z`, so `bumpp` is not run again.

  ```sh
  gh release delete vX.Y.Z --yes
  git push origin :refs/tags/vX.Y.Z
  git tag -d vX.Y.Z
  # after the fix is on main
  git tag vX.Y.Z && git push origin vX.Y.Z
  ```

- Failure in the npm step: first approve or reject every package the run already staged, with `npm stage list`. Then re-run from the Actions tab. The step skips published versions but cannot see staged ones, and npm rejects a second stage of the same version.
- A staged package you do not trust: `npm stage reject <stage-id>`, then ship a patch release. Nothing reached users.
- Failure after the tap step, or a bug found in a shipped version: ship a patch release.
