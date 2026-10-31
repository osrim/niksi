# Lockfile format

`niksi-lock.json` records every installed skill in a scope: where it came from, which revision, a sha256 of its files, where it is placed, and what its review accepted. This page is the format specification, for tools that read or write the file. Scopes and paths are in [configuration.md](configuration.md#scope), and the commands that read and write the file are in [commands.md](commands.md).

This page describes lockfile version 2. When `niksi` reads the file, it checks the type and required columns of every table and each rule that says "must". A file that breaks one fails to load. The other statements describe what `niksi` writes. It does not check them on read, for example that a local source has no `commit`.

## File

| scope | path |
| --- | --- |
| project | `<project root>/niksi-lock.json` |
| global | `~/.config/niksi/niksi-lock.json`, or a legacy path, see [Paths](configuration.md#paths) |

The file is one JSON object in UTF-8. `niksi` reads a missing file, an empty file, or a file of only whitespace as a lockfile with no skills.

## Top-level object

| field | type | required | meaning |
| --- | --- | --- | --- |
| `lockfileVersion` | number | yes | Format version. It must be `1` or `2`. `niksi` writes `2`. See [Versions](#versions). |
| `skills` | object | no | Map from skill name to [entry](#entry-fields). Absent reads as `{}`. `niksi` always writes it. |

## Skill names

Each key of `skills` is a skill name. `niksi` uses it as the directory name of the skill's canonical copy, its links, and its copies, so it must be one path segment:

- not empty
- not `.` or `..`
- no `/` or `\`

## Entry fields

An entry holds one skill. Absent optional fields are left out of the object, never written as `null`.

| field | type | required | meaning |
| --- | --- | --- | --- |
| `source` | string | yes | Source id. See [Sources](#sources). |
| `branch` | string | no | Default branch of a Git source, or the branch you pinned. Absent for local sources. |
| `path` | string | yes | Skill directory inside the source. `niksi` writes a relative path with `/` separators, and `""` for the source root. |
| `root` | string | no | Discovery root inside the source: the directory a forge URL such as `https://github.com/o/r/tree/main/plugins/x` points to, or the local directory you typed. Absent when `add` searched the whole source. `update` checks dependencies within it. |
| `commit` | string | no | Installed commit of a Git source. It must be 40 or 64 lowercase hex characters. Absent for local sources. |
| `integrity` | string | yes | sha256 of the skill's files. It must be `sha256-` followed by 43 base64 characters and one `=`: the standard base64 of 32 bytes. See [Integrity](#integrity). |
| `track` | string | yes | It must be `auto` or `pin`. See [Revisions](#revisions). |
| `pinnedAs` | string | no | The ref a pinned entry is pinned to, when it is not a branch or a full commit. See [Revisions](#revisions). |
| `tag` | string | no | Installed stable release tag. See [Revisions](#revisions). |
| `copy` | `true` | no | The skill is a copy, not a link. Absent means a link. It must not be `false`. |
| `agents` | array of strings | no | Agent ids. It must name at least one. See [Placement](#placement). |
| `copyPath` | string | no | Destination root of a path copy, relative to the project root. See [Placement](#placement). |
| `review` | object | no | What the review of this content decided. See [Review](#review). |
| `disabled` | `true` | no | Set by `nik disable`. Absent means enabled. It must not be `false`. `install` and `update` skip a disabled entry, and `nik enable` removes the field. |

### Sources

`source` must have one of these shapes:

| shape | example |
| --- | --- |
| `https://`, `ssh://`, or `file://` URL | `https://github.com/anthropics/skills` |
| `[user@]host:path` address | `git@github.com:acme/team-skills.git` |
| `local:` followed by a path | `local:.` |

In a `host:path` address, the user and the host must not start with `-`, and the path must not start with `:` or `//`. Git would read such an argument as an option or as a remote helper.

A local path that is not absolute resolves from the project root. In project scope, `niksi` records a local directory inside the project root as `local:.`, the project root. It records a local directory outside it, a symlink to one, or any local directory in global scope as `local:/`, the filesystem root. The rest of the location goes in `path` and `root`, so `nik add ./skills/demo` and `nik add ./skills demo` both record `path` as `skills/demo`. Other machines cannot resolve a `local:/` entry, so in project scope `add` asks first. Entries that record another local path, such as `local:./skills/demo`, still load.

### Revisions

| source | `track` | revision fields |
| --- | --- | --- |
| Git, followed | `auto` | `commit` and `branch`, the default branch. `tag` when `commit` is the latest stable release tag. Without such a tag, `commit` is the head of `branch`. |
| Git, pinned to a branch | `pin` | `commit` and `branch`, the pinned branch. |
| Git, pinned to a full 40-character commit | `pin` | `commit` and `branch`, the default branch. |
| Git, pinned to a tag or any other ref | `pin` | `commit`, `branch`, the default branch, and `pinnedAs`, the ref you typed. |
| Git, pinned, after `nik update` names it | `pin` | `branch`, unchanged. When the source has a stable release tag, `commit` is the commit of the latest one, and `tag` and `pinnedAs` both name it. Otherwise `commit` is the head of `branch`, with no `tag` or `pinnedAs`. |
| local | `auto` | none |

### Placement

Every entry must have exactly one placement, set by `copy`, `agents`, and `copyPath`:

| placement | `copy` | `agents` | `copyPath` |
| --- | --- | --- | --- |
| link | absent | optional | absent |
| agent copy | `true` | required | absent |
| path copy | `true` | absent | required |

A link entry's `agents` lists the agents that `install` and `enable` link it to. A link entry without `agents` is linked to the agents you choose. An agent copy's `agents` lists the agents that received a copy.

An agent id must be one of `universal`, `claude`, `opencode`, `kiro`, `cline`, and `qwen`. Each names a skills directory, listed in [configuration.md](configuration.md#agents). `niksi` writes a link entry's agents in that order. It does not sort the agents of an agent copy, and does not check for an agent listed twice.

`copyPath` is `.`, the project root itself, or a relative path made of segments separated by `/`. It must not contain `\`, an empty segment, `.`, or `..`, and must not be absolute in POSIX or Windows form. The skill's files are in `<copyPath>/<skill name>`. A path copy must be in a project lockfile: a global lockfile with a path copy fails to load. When it loads a project lockfile, `niksi` also resolves symlinks and rejects a `copyPath` or skill directory that resolves outside the project root.

`root` must follow the same rules as `copyPath`, except that it must not be `.`: leave `root` out for the source root.

`review` and `disabled` don't depend on placement. A disabled entry keeps its placement, so `enable` can restore it.

## Review

`review` holds only for the entry's current `integrity`. When `add` or `update` reviews content, it replaces `review` with the outcome of that review. A write without a new review, such as adding a skill to another agent or moving the revision of unchanged files, keeps `review` while `integrity` stays the same. When you write a new `integrity` yourself, remove `review` as well, or the old review applies to new content.

A `review` object must contain at least one of its fields. `niksi` leaves `review` out when there is nothing to record.

| field | type | required | meaning |
| --- | --- | --- | --- |
| `acceptedRules` | array of strings | no | Rule ids of the critical findings approved for this integrity. It must name at least one. Each id must be lowercase letters and digits in groups joined by `-`, such as `curl-pipe-shell`. `nik audit` reports the findings of these rules as accepted, without exit `3`. See [security-scan.md](security-scan.md#accepted-findings). |
| `external` | object | no | Verdict of an external scanner. No current command writes it, and a review by `add` or `update` drops it. |

The record is not signed. Whoever can edit the file can edit `acceptedRules`, so review a change to it like any other dependency change.

### External verdict

| field | type | required | meaning |
| --- | --- | --- | --- |
| `tool` | string | yes | Scanner name. It must not be empty. |
| `version` | string | yes | Scanner version. It must not be empty. |
| `result` | string | yes | The scanner's verdict. It must not be empty. |
| `findings` | number | yes | Number of findings. It must be an integer of `0` or more. |

## Integrity

`integrity` is a sha256 over the skill's files. `install` and `enable` verify every file against it before they write. For a local source, `install` and `update` also compare the source directory with it to detect edits.

### Which files count

The files are every file inside the skill directory, at any depth, with these exceptions:

- Anything inside a directory named `.git` or `node_modules` is left out.
- From a Git source, a file or symlink named `.git` or `node_modules` is left out as well. A local directory keeps it.
- From a Git source, submodules (mode `160000`) are left out.
- From a local directory, only regular files and symlinks count. Empty directories add nothing.

Each file has three values:

| value | Git source | local directory |
| --- | --- | --- |
| path | path relative to the skill directory, with `/` separators | the same |
| mode | the tree entry mode: `100644`, `100755`, or `120000` | `120000` for a symlink, else `100755` when any execute bit is set, else `100644` |
| content | the blob bytes. For a symlink, the target path. | the file bytes. For a symlink, the target path in UTF-8. Symlinks are not followed. |

### Computing the integrity

1. Sort the files by path, comparing UTF-16 code units, which is JavaScript string order. This differs from byte order only for characters outside the Basic Multilingual Plane.
2. For each file, in order, feed the outer sha256:
   1. the UTF-8 bytes of the path, a NUL byte, the mode as ASCII, and a NUL byte
   2. the 32-byte raw sha256 digest of the content
   3. a line feed byte (`0x0a`)
3. Encode the 32-byte outer digest as standard base64 with padding and prefix `sha256-`.

The same steps in Python:

```python
import base64
import hashlib

def integrity(files):
    """files: a list of (path, mode, content) with path as str and content as bytes."""
    outer = hashlib.sha256()
    for path, mode, content in sorted(files, key=lambda f: f[0].encode("utf-16-be")):
        outer.update(path.encode() + b"\0" + mode.encode() + b"\0")
        outer.update(hashlib.sha256(content).digest())
        outer.update(b"\n")
    return "sha256-" + base64.b64encode(outer.digest()).decode()
```

### Worked example

A skill with two files:

| path | mode | content |
| --- | --- | --- |
| `SKILL.md` | `100644` | `---\nname: hello\ndescription: Print a greeting.\n---\n\nRun scripts/hello.sh.\n` |
| `scripts/hello.sh` | `100755` | `#!/bin/sh\necho hello\n` |

`\n` is a line feed. The integrity is `sha256-cK+7w8B4PYFOwOYiIEm6U+QcZIGnDh12sE+ehQfgKus=`. The `hello` entry in the [complete example](#complete-example) records it.

## Writing the file

`niksi` writes one canonical form, so a write that changes nothing leaves the file byte for byte the same:

- JSON with two-space indentation, as JavaScript's `JSON.stringify(value, null, 2)` writes it, and one line feed at the end.
- `lockfileVersion` first, then `skills`.
- Skill names sorted in UTF-16 code unit order.
- Entry fields in the order of the [entry fields](#entry-fields) table. `review` fields in the order `acceptedRules`, `external`, and external verdict fields in the order `tool`, `version`, `result`, `findings`.
- Every array element on its own line.

`niksi` writes the file atomically: it writes a temporary file and renames it over the lockfile. A tool that writes the same form keeps diffs of the file small.

## Reading the file

`niksi` reads the whole file before it acts, and stops with an error at the first rule a field breaks. The error names the lockfile path and the skill, for example `/work/repo/niksi-lock.json: grilling: missing integrity`.

Fields that this page does not define are ignored, at every level, and are gone after the next write. Don't store data of your own in the lockfile.

## Versions

`niksi` reads lockfile versions 1 and 2 and always writes version 2. Any other `lockfileVersion` fails to load with `unsupported lockfile version <n>`.

Version 1 differs from version 2 in two rules:

- Only copies may contain `agents`. A version 1 link entry with `agents` fails to load, so a version 1 link entry records no agents.
- There is no `review`. A `review` field in a version 1 file is ignored.

The next command that writes a version 1 lockfile rewrites it as version 2. Commands that only read the lockfile, such as `install`, `list`, and `audit`, leave it at version 1.

### Older releases

Releases before lockfile version 2 reject a version 2 lockfile with `unsupported lockfile version 2`. Releases without path-copy support reject path-copy entries, because they have `copy: true` but no `agents`. Without disable support, releases drop `disabled` and install the entry. Without discovery-root support, releases drop `root` and check dependencies across the whole source.

## Complete example

This lockfile uses every field on this page. The `grilling` entry is a link to two agents that follows a Git source and accepted one critical rule. `hello` is a path copy of a local skill. `pdf` is an agent copy that was pinned to a tag and then moved to release `v1.3.0` by `nik update pdf`. `tdd` is a disabled link pinned to a branch of a source reached over SSH.

```json
{
  "lockfileVersion": 2,
  "skills": {
    "grilling": {
      "source": "https://github.com/acme/agent-skills",
      "branch": "main",
      "path": "skills/grilling",
      "root": "skills",
      "commit": "ef34461592493735c5512d5858ee1e8903a4e3d8",
      "integrity": "sha256-fiekTL6uyu/7cm4eIS6G6wajw0J7tGDiFbaRvbt/Tfk=",
      "track": "auto",
      "tag": "v1.4.0",
      "agents": [
        "universal",
        "claude"
      ],
      "review": {
        "acceptedRules": [
          "curl-pipe-shell"
        ],
        "external": {
          "tool": "example-scanner",
          "version": "2.3.1",
          "result": "pass",
          "findings": 0
        }
      }
    },
    "hello": {
      "source": "local:.",
      "path": "skills/hello",
      "root": "skills",
      "integrity": "sha256-cK+7w8B4PYFOwOYiIEm6U+QcZIGnDh12sE+ehQfgKus=",
      "track": "auto",
      "copy": true,
      "copyPath": "docs/agent-skills"
    },
    "pdf": {
      "source": "https://github.com/anthropics/skills",
      "branch": "main",
      "path": "skills/pdf",
      "commit": "6843f7b2c4d0cdc4ceef05cf361f1f31d23be8c0",
      "integrity": "sha256-qad+ZaRSh4bzHlgr7uNOl6i8bDZC09Dh4TbbG39PfCI=",
      "track": "pin",
      "pinnedAs": "v1.3.0",
      "tag": "v1.3.0",
      "copy": true,
      "agents": [
        "claude"
      ]
    },
    "tdd": {
      "source": "git@github.com:acme/team-skills.git",
      "branch": "stable",
      "path": "tdd",
      "commit": "bfa9487845f430356f3bc2094291f9be071adf97",
      "integrity": "sha256-hsYtriugl5fZWXxAViYjC/hscKl02sDn7/tEqcA4gxg=",
      "track": "pin",
      "agents": [
        "claude"
      ],
      "disabled": true
    }
  }
}
```
