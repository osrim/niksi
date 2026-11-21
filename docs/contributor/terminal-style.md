# Terminal style

For contributors. Rules for what `niksi` prints and asks. User-facing behavior of prompts, flags, and exit codes is in [commands.md](../commands.md).

## Streams

Human output goes to stdout inside a Clack frame. Runtime warnings, errors, and the update notice go to stderr. The review stays on stdout: the security findings, the `Review files before installing.` caution, the `skipped` line of a declined or blocked skill, and the cooldown warning of `add`. So do the notes that `audit` prints with its findings. `list --json`, `audit --json`, and `update --check --json` write only JSON to stdout.

The internal `__scan-source` command writes JSON counts to stdout and discovery warnings and findings to stderr. The GitHub Action puts stderr in the job log.

## Prompts

Every prompt has a flag replacement, and the replacements do not overlap:

- `--all` selects skills. It never confirms a write.
- `--yes` accepts ordinary confirmations and defaults. It never approves a critical finding, or a warn finding when the project policy sets `denyWarn`.
- `--dangerous-skip-critical-approval` skips critical approval for the current invocation. It keeps file lists and findings visible and does not accept warn findings or confirm a write. Under `denyWarn`, it skips the approval of warn findings too, since they gate as critical.
- In `add`, `adopt`, and `update`, a critical finding needs a terminal unless `--dangerous-skip-critical-approval` is provided. Without either, the skill is skipped with exit `3`. Under `denyWarn`, a warn finding gets the same critical question and the same exit.
- An ordinary prompt with no terminal and no replacement flag exits `2` with a message that names the flag, except in `install`.

Without a terminal, `install` keeps modified skills and installs the other entries, because restoring silently would destroy edits.

Each skill gets at most one review question.

A review question and the write confirmation of `add` and `update` are a select with `Yes`, `No`, and `Read files…`. `Read files…` opens the pager and then asks the same question again, so reading adds no question. Its hint is `press q to return`. The defaults stay `Yes` for warn and write, and `No` for critical. A question with nothing to read stays a yes/no confirm. The session contents are in [security-scan.md](../security-scan.md#reading-files).

Cancel exits `130` with `Cancelled.` Completed writes remain completed.

## Defaults

Announce a default when the user did not choose it:

```text
Using project scope. Use -g for global.
Linking to claude.
```

`--path` selects project scope and a destination root. It prints no scope or agent default.

`install` and `enable` select agents only when the entries they restore include a link entry without recorded agents. When every link entry records agents, or there are only copies, they print no agent default. With `--agent`, they print `Ignoring --agent. Every lockfile entry records its destination.` on stderr.

## Result lines

Use `name: result` for one skill. Name the skill once. Put a remedy on the next line when there is one. Never print a stack trace.

```text
grilling: installed @ v1.2.0
grilling: restored @ v1.2.0
grilling: removed from custom-directory/grilling
grilling: source no longer has skills/grilling
grilling: v2.0.0 available, 1 day old, waits for cooldown
```

A failed skill does not stop the batch. The command continues, writes state that matches disk, and exits `1`.

No-op messages are `Nothing selected.`, `Nothing to add|adopt|copy|install|update.`, `Nothing added.` after a declined warning, or `Nothing adopted.` when no selected skill could be checked. When the project policy refuses an entry, `install` and `enable` end with `Nothing installed.` or `Nothing enabled.` and a remedy line. `install --frozen-lockfile` without a lockfile names the path it looked for, then `Nothing installed.` and a remedy line. When it refuses the source, `add` ends with `Nothing added.`, and `adopt` with `Nothing adopted.` for a `--source`, each with a remedy line. `update`, and `adopt` for a source found on disk, print the refusal and its remedy as the skill's result line and continue.

## Color

| style | meaning |
| --- | --- |
| cyan | skill name |
| bold | heading |
| dim | secondary text or missing state |
| green | success |
| orange | needs attention |
| red | failure or critical finding |
| blue | information |

Paint through `ui/style.ts` only. It resolves `NO_COLOR`, `FORCE_COLOR`, `TERM=dumb`, and non-TTY output, and strips escape codes that Clack emits when color is off. Pass text from a skill or a source, such as a path, a frontmatter value, or a finding detail, through `escapeControl` before you paint, measure, or print it. For a single value, such as a name or a path, use `escapeLine`, which also marks tabs and newlines so the value stays on one row. `skillName` and `summarize` escape for you.

## Tables and spinners

Tables have no borders. Group rows by source and indent skill rows by two spaces. Measure rendered width with `Bun.stringWidth`.

One spinner covers one wait. Its final line states the result. Spinners do not nest. Start one through `ui/prompt.ts`, never Clack directly: when stdout is not a terminal, it prints only the final line, with no cursor codes.

## Lockfile errors

A lockfile error is `file: name: message`, where `name` is the skill name of the lockfile entry. An invalid skill name is JSON-quoted so an empty or slash-containing name stays visible. File-level errors have no name.

```text
niksi-lock.json: grilling: missing integrity
niksi-lock.json: "": invalid skill name
niksi-lock.json: unsupported lockfile version 9
```
