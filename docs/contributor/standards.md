# Code standards

For contributors. Every change under `cli/` must pass the required checks below. Module boundaries are in [architecture.md](architecture.md).

## TypeScript

Keep strict mode and its current checks. Do not use `any` or weaken compiler options. Narrow `unknown`, keep type imports explicit, and include `.ts` in import paths. Target Bun and modern ECMAScript.

## Lint and format

Oxlint enforces correctness, suspicious-code, function-style, and async rules. Exported and local functions use arrow syntax. Source adapter classes may use methods. Oxfmt owns formatting.

Do not disable a rule unless the exception is required and explained in place.

## Functions and modules

- Keep functions at 100 lines or fewer, with at most five positional parameters.
- Split files by responsibility. Use kebab-case filenames.
- Use `index.ts` only for a real module, never as a barrel.
- Command files export only `run` and `help`. Keep help copy beside its command.
- Remove code your change makes unused.

## Comments

Always prefer self-documented code over comments. Comment only when the code cannot explain a constraint or a reason. Do not add file summaries, restated types, control-flow narration, typed JSDoc, or history notes. Remove stale comments you touch.

## Tests

Tests import core and UI functions into one Bun process. Subprocess tests live in `commands/<topic>.integration.test.ts` and use `Bun.spawn` only when the process boundary is the behavior under test.

Otherwise, check command registration, argument wiring, and exit codes by hand. Add a `-y` harness case when a manual check becomes unreliable.

- Add unit tests for changed `core/` behavior. Network modules require tests.
- Assert against literals, worked examples, fixtures, or documented contracts. Do not copy implementation logic into assertions.
- Use temporary directories and restore environment changes with `test-env.ts`.
- Cover branches and failure paths. Do not chase a coverage number.
- Manually test changed command paths, non-interactive errors, and exit codes.

## Required checks

Run from `cli/`:

```sh
bun run typecheck
bun run lint
bun run fmt:check
bun run test
```

CI runs the same checks. PR titles use a conventional commit type and a lowercase subject.

## Scan rules

The local scan may gain rules and widen existing ones. Every new or widened rule under `cli/src/core/scan/` meets this bar:

- It runs offline and is deterministic.
- It adds no runtime dependency.
- It ships with at least one fire case and one silent case in `cli/src/core/scan/fixtures/<rule>.ts`.
- `critical` needs strong evidence: code runs, data leaves the machine, content is hidden, or a documented combination of signals.
- A rule that reads prose starts at `warn`. It reaches `critical` only through a documented combination, hidden content, or the frontmatter `description`.
- An unfamiliar host alone is never a finding.
- A rule may port a technique from another scanner, but copies rule text or data only under a license that allows it. Write niksi's own regex for a technique from a Semgrep rule.

A silent case states the highest severity it may produce. A case marked `known` pins a wrong result at today's severity. The change that fixes it updates the case and removes the mark. Probes that no rule catches yet go in `fixtures/unclaimed.ts`. The rule that catches a probe moves it into that rule's own fixture file.

No rule may report `critical` on the benign corpus in `cli/testdata/benign-skills/`.

External audit services are an extra gate input, never a replacement for these rules.

## Supply chain

- Bun is pinned by `.bun-version`.
- Commit `bun.lock` and use frozen installs in CI.
- Pin GitHub Actions to full commit SHAs.
- Start workflows with `permissions: {}` and grant only what a job needs.
- Review `trustedDependencies` as executable third-party code.
- Add a dependency only when Bun, Node, and the current packages cannot cover the need.

## Repository hygiene

Do not commit `.DS_Store`, `cli/dist/`, or machine-local skill links. The project uses the MIT license.
