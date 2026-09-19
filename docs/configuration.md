# Configuration

Where `niksi` writes files, which environment variables it reads, and what the lockfile contains. Commands and flags are in [commands.md](commands.md).

## Scope

A skill is installed in one scope.

| scope | flag | skills live in | lockfile |
| --- | --- | --- | --- |
| project | `-p` | `<project root>/.niksi/skills` | `<project root>/niksi-lock.json` |
| global | `-g` | `~/.local/share/niksi/skills` | `~/.config/niksi/niksi-lock.json` |

The project root is the nearest parent directory that holds `niksi-lock.json`, `.agents`, `.claude`, `.opencode`, `.kiro`, `.cline`, `.qwen`, or `.git`. The search stops at your home directory. Without a marker, the current directory is the root.

`nik add` asks for the scope. Every other command defaults to project scope. Running from your home directory selects global scope.

## Agents

An agent is a tool that loads skills. `niksi` writes a relative symlink from a skills directory that the agent reads to the skill in the scope's `skills` directory, or a real copy when you pass `--copy`.

| id | skills directory | project | global |
| --- | --- | --- | --- |
| `universal` | Universal | `.agents/skills` | `~/.agents/skills` |
| `claude` | Claude Code | `.claude/skills` | `$CLAUDE_HOME/skills` or `~/.claude/skills` |
| `opencode` | OpenCode | `.opencode/skills` | `$XDG_CONFIG_HOME/opencode/skills` or `~/.config/opencode/skills` |
| `kiro` | Kiro | `.kiro/skills` | `~/.kiro/skills` |
| `cline` | Cline | `.cline/skills` | `~/.cline/skills` |
| `qwen` | Qwen Code | `.qwen/skills` | `~/.qwen/skills` |

`--agent` takes an id from the table above or an agent name from the table below. An id selects its own directory, so `--agent opencode` means `.opencode/skills`. A name resolves to the first directory listed for that agent, so `--agent cursor` means `.agents/skills`. `niksi` detects an agent when its config directory, project directory, or binary exists, and only in a scope where the agent reads a directory from the table.

| agent | `--agent` name | reads in project scope | reads in global scope | detected when |
| --- | --- | --- | --- | --- |
| Claude Code | `claude` | `claude` | `claude` | `$CLAUDE_HOME` or `~/.claude` exists, or `.claude` exists in the project |
| Codex | `codex` | `universal` | `universal` | `$CODEX_HOME` or `~/.codex` exists, `/etc/codex` exists, or `codex` is on `PATH` |
| Cursor | `cursor` | `universal`, `claude` | `universal`, `claude` | `~/.cursor` exists, or `.cursor` exists in the project |
| Gemini CLI | `gemini` | `universal` | `universal` | `~/.gemini` exists, `.gemini` exists in the project, or `gemini` is on `PATH` |
| GitHub Copilot | `copilot` | `universal`, `claude` | `universal` | `~/.copilot` exists, or `copilot` is on `PATH` |
| Windsurf | `windsurf` | `universal` | `universal` | `~/.codeium/windsurf` exists, or `.windsurf` exists in the project |
| Amp | `amp` | `universal`, `claude` | `universal`, `claude` | `$XDG_CONFIG_HOME/amp` or `~/.config/amp` exists, or `amp` is on `PATH` |
| Antigravity | `antigravity` | `universal` | none | `~/.gemini/antigravity` exists |
| Factory Droid | `droid` | `universal` | `universal` | `~/.factory` exists, `.factory` exists in the project, or `droid` is on `PATH` |
| Roo Code | `roo` | `universal` | `universal` | `~/.roo` exists, or `.roo` exists in the project |
| Zed | `zed` | `universal` | `universal` | `$XDG_CONFIG_HOME/zed` or `~/.config/zed` exists, or `zed` is on `PATH` |
| Junie | `junie` | `universal` | `universal` | `~/.junie` exists, or `.junie` exists in the project |
| Kilo Code | `kilo` | `universal` | none | `~/.kilo` or `~/.kilocode` exists, or `.kilo` exists in the project |
| Warp | `warp` | `universal`, `claude`, `opencode` | `universal`, `claude`, `opencode` | `~/.warp` exists, or `warp` is on `PATH` |
| Augment Code | `augment` | `universal`, `claude` | `universal`, `claude` | `~/.augment` exists, or `.augment` exists in the project |
| Trae | `trae` | `universal` | none | `~/.trae` exists, or `.trae` exists in the project |
| Kiro | `kiro` | `kiro` | `kiro` | `~/.kiro` exists, `.kiro` exists in the project, or `kiro` is on `PATH` |
| Cline | `cline` | `cline`, `claude` | `cline` | `~/.cline` exists, or `.cline` exists in the project |
| Qwen Code | `qwen` | `qwen` | `qwen` | `~/.qwen` exists, or `.qwen` exists in the project |
| OpenCode | `opencode` | `universal`, `claude`, `opencode` | `universal`, `claude`, `opencode` | `$XDG_CONFIG_HOME/opencode` or `~/.config/opencode` exists, `.opencode` exists in the project, or `opencode` is on `PATH` |

Without `--agent`, `niksi` asks which agents to link to, one row per skills directory. It preselects the cover: the smallest set of directories that every detected agent reads. Rows a detected agent reads sit under `Detected`, with those agents named beside them. The rest sit under `Other`. Without a terminal it uses the remembered choice, else the cover, else `claude`.

When a detected agent reads two or more of the chosen directories, `niksi` warns that the agent loads skills twice and names the directories you can drop. A directory can be dropped when every detected agent still reads one of the remaining ones. When every chosen directory is needed, there is no warning.

Editing a linked skill changes it for every linked agent.

In project scope, `.niksi/.gitignore` keeps the skill directories out of Git. Links in the agents' skills directories are hidden with `.git/info/exclude`, in a block that `niksi` rebuilds after every write. Commit `niksi-lock.json`. Copies made with `--copy` can be committed.

## Path copies

`nik add --copy --path <directory>` writes each selected skill to `<directory>/<skill name>`. The destination root uses project scope.

This command does not select or remember agents. Path copies remain visible to Git.

`niksi` resolves relative input from the project root, even when the command runs in a subdirectory. It accepts absolute input only inside the project root.

`niksi` records a normalized project-relative `copyPath`. It rejects traversal and symlinks that escape the project. `niksi` repeats this check when it reads the lockfile.

`niksi` manages a named skill directory only when the lockfile contains a matching entry. `update` and an approved `install` may replace that directory.

`remove` deletes the skill directory. It keeps the destination root and its other contents.

## Remembered choices

When you pick a scope or agents in a prompt, or pass `-g`, `-p`, or `--agent`, `niksi` remembers the choice in `config.json` and preselects it next time. A new choice replaces the remembered one. A config file that fails to parse is ignored.

```json
{
  "scope": "project",
  "agents": ["claude", "universal"]
}
```

## Paths

`niksi` follows the XDG base directory specification.

| path | default | variable |
| --- | --- | --- |
| global skills | `~/.local/share/niksi/skills` | `XDG_DATA_HOME` |
| global lockfile | `~/.config/niksi/niksi-lock.json` | `XDG_CONFIG_HOME` |
| store | `~/.local/share/niksi/store` | `XDG_DATA_HOME` |
| config | `~/.config/niksi/config.json` | `XDG_CONFIG_HOME` |
| update-check cache | `~/.cache/niksi/last-update-check` | `XDG_CACHE_HOME` |

`NIKSI_HOME` replaces the data and config roots at once. `NIKSI_HOME=/tmp/x` puts the global skills, the global lockfile, the store, and the config under `/tmp/x`. It does not move the cache.

### Migrating from ski

Before 0.3.0 the project was named `ski`. The first `nik` command in a project renames `ski-lock.json` to `niksi-lock.json` and `.ski` to `.niksi`, re-points the agent skill links, renames the block in `.git/info/exclude`, and moves `~/.config/ski/config.json` to `~/.config/niksi/config.json`. The first `nik` command with `-g` moves the global skills, lockfile, store, config, and cache from `~/.local/share/ski`, `~/.config/ski`, and `~/.cache/ski` to `niksi` the same way. A skills directory or lockfile whose new path already exists is left alone. An old store, cache, or config beside a new one is deleted. `SKI_HOME` is now `NIKSI_HOME`. A set `SKI_HOME` without `NIKSI_HOME` exits `2`.

### Moving an existing global lockfile

The global lockfile is `$XDG_CONFIG_HOME/niksi/niksi-lock.json`, or `~/.config/niksi/niksi-lock.json` when `XDG_CONFIG_HOME` is unset. If that file does not exist, `niksi` keeps using the legacy lockfile at `$XDG_DATA_HOME/niksi/niksi-lock.json`, which defaults to `~/.local/share/niksi/niksi-lock.json`. Reads and writes keep using the legacy file until you move it.

When both files exist, `niksi` uses the config file. Confirm that the config file does not already exist, then migrate by moving the legacy file:

```sh
config_home=${XDG_CONFIG_HOME:-"$HOME/.config"}
data_home=${XDG_DATA_HOME:-"$HOME/.local/share"}
mkdir -p "$config_home/niksi"
mv "$data_home/niksi/niksi-lock.json" "$config_home/niksi/niksi-lock.json"
```

Do not copy the file. Leaving both paths populated makes the legacy file inactive and lets the two files drift. `NIKSI_HOME` users do not need to migrate because both paths resolve to `$NIKSI_HOME/niksi-lock.json`.

Every path variable, including `HOME` and `CLAUDE_HOME`, must be an absolute path. `~` is not expanded.

The store is a download cache. A lockfile entry installs without the network when the store holds its content, and every installed skill keeps working if you delete the store.

## Lockfile

`niksi-lock.json` records every installed skill in a scope. `nik install` recreates the installation from it.

```json
{
  "lockfileVersion": 1,
  "skills": {
    "pdf": {
      "source": "https://github.com/anthropics/skills",
      "branch": "main",
      "path": "skills/pdf",
      "commit": "474e3e791559398762c4f5eff1399efe8f402156",
      "integrity": "sha256-Y7e8N/hx+rfGdAq0eQxb/7nXc6OLzBdbqVICpPivokY=",
      "track": "auto",
      "copy": true,
      "copyPath": "custom-directory"
    }
  }
}
```

| field | meaning |
| --- | --- |
| `source` | Git URL of the source, or `local:` followed by its path. A directory inside the project root is recorded relative to it. One outside, or a symlink to one, is recorded by a path that other machines cannot resolve, so `add` asks first. |
| `path` | Skill directory inside the source. |
| `integrity` | sha256 of the installed skill files. `install` verifies every file against it. |
| `track` | `auto` follows the latest stable tag or the branch. `pin` stays at the ref you typed. |
| `commit` | Installed commit. Absent for local sources. |
| `branch` | Default branch of the source, or the branch you pinned. Absent for local sources. |
| `tag` | Installed tag. |
| `pinnedAs` | The ref you typed after `@`, when it is not a branch or commit. |
| `copy` | `true` when the skill was added with `--copy`. |
| `agents` | Agents that received an agent copy. Link and path-copy entries do not record agents. |
| `copyPath` | Normalized project-relative destination root for a path copy. |
| `disabled` | `true` after `nik disable`. Absent means enabled. The entry keeps its placement. `install` and `update` skip it until `nik enable` clears it. |

A copy entry has exactly one placement: a non-empty `agents` array or `copyPath`. Link entries have neither. `disabled` does not depend on placement. It is the last key. Lockfile version 1 remains in use.

Releases without path-copy support reject these entries because `copy: true` has no `agents` field. Releases without disable support drop the `disabled` field and install the entry.

## Environment variables

| variable | effect |
| --- | --- |
| `NIKSI_HOME` | Root for data and config. See [Paths](#paths). |
| `XDG_DATA_HOME`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME` | Standard XDG roots. |
| `CLAUDE_HOME` | Global Claude directory. Default `~/.claude`. |
| `NO_COLOR` | Disable color. |
| `FORCE_COLOR` | Enable color when stdout is not a terminal. |
| `CI`, `NO_UPDATE_NOTIFIER`, `NIKSI_NO_UPDATE_NOTIFIER` | Disable the update notice and its release check. |

Color is also off when stdout is not a terminal or `TERM=dumb`.

## Update notice

Every `nik` run that exits `0` prints a notice on stderr, after its own output, while the installed version is older than the latest GitHub release. This includes `nik`, `nik --version`, `nik list`, and `nik remove`. Help for a single command, such as `nik add --help`, prints no notice. The notice names `brew upgrade` for a Homebrew install and `npm install -g niksi` for an npm install. Otherwise it links to the latest release. It stops on the first run after you upgrade.

`niksi` asks GitHub for the latest release once a day and stores the check time and the version it found in the update-check cache. Runs between checks reuse the cached version. A failed request is silent and leaves the cache untouched, so the next run checks again. A cache file that does not parse, does not match the expected shape, holds the legacy bare timestamp, or records a check time in the future counts as no prior check, so the run asks GitHub again.

No request is made and no notice is printed when stdout is not a terminal, when `--json` is set, when `niksi` runs from a Git checkout, or when one of the variables above is set. A command that fails prints no notice.
