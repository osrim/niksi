import { expect, test } from "bun:test";
import { releaseNotes } from "./release-notes.ts";

const PULL = "https://github.com/osrim/niksi/pull";

test("releaseNotes groups PRs by conventional-commit type", () => {
  const generated = `## What's Changed
* feat(cli): add prune command by @osrim in ${PULL}/28
* chore(deps): update all non-major dependencies by @renovate[bot] in ${PULL}/29
* fix(cli)!: update only the selected skills by @osrim in ${PULL}/30
* Bump the lockfile by @someone in ${PULL}/31

## New Contributors
* @someone made their first contribution in ${PULL}/31

**Full Changelog**: https://github.com/osrim/niksi/compare/v0.3.3...v0.3.4`;

  expect(releaseNotes(generated)).toBe(`## Release notes

### Features

- Add prune command (#28)

### Fixes

- Update only the selected skills (#30)

### Other

- Update all non-major dependencies (#29)
- Bump the lockfile (#31)

### New Contributors
* @someone made their first contribution in ${PULL}/31

**Full Changelog**: https://github.com/osrim/niksi/compare/v0.3.3...v0.3.4
`);
});

test("releaseNotes leaves out groups with no PRs", () => {
  const generated = `## What's Changed\n* fix(cli): stop the crash by @osrim in ${PULL}/32`;
  expect(releaseNotes(generated)).toBe("## Release notes\n\n### Fixes\n\n- Stop the crash (#32)\n");
});

test("releaseNotes keeps notes that list no PRs", () => {
  const generated = "**Full Changelog**: https://github.com/osrim/niksi/compare/v0.3.3...v0.3.4";
  expect(releaseNotes(generated)).toBe(`## Release notes\n\n${generated}\n`);
});
