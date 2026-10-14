# AgentGuild CLI

Installs AgentGuild agents, skills, and commands into a project's `.claude/` folder.
Requires Node.js 22 or newer and an authenticated GitHub CLI account with access to the
selected private kit repository.

The npm package is not published yet. Run the public installer directly from GitHub:

```bash
npx --yes --package=github:getagentguild/cli agentguild --kit=games
```

Run the command anywhere inside a project, or pass a project path explicitly. The CLI
walks upward to the nearest defensible root identified by `.git`, `package.json`, or the
Unity markers `Assets` and `ProjectSettings/ProjectVersion.txt`. It refuses to install
outside a recognized project and never chooses a home directory or filesystem root.

The first remote install clones the selected kit into `~/.agentguild/cache`. Later runs
reuse that cache without network mutation. Pass `--update` when you want cached kits
fast-forwarded before installation:

```bash
npx --yes --package=github:getagentguild/cli agentguild --kit=games --update
```

Use `--from=/path/to/kit` to install from a local kit checkout. Kit CI can validate a
checkout without project-root detection:

```bash
agentguild validate /path/to/kit
```

The installer can install the complete kit or an interactive selection. Unchanged files
are skipped, modified files are preserved as conflicts, and existing `CLAUDE.md` content
is backed up before its managed AgentGuild block is changed. Registry paths must use the
canonical layouts `agents/<id>.md`, `commands/<id>.md`, and
`skills/<id>/SKILL.md`. Symlinked or non-regular kit sources, cache checkouts, and project
destinations are refused before the installer writes any selected item.

## Kit working agreements in CLAUDE.md

A kit can ship a short markdown file of working agreements that the installer adds to the managed
AgentGuild block of `CLAUDE.md`, so every session starts with them. The kit's `registry.json` names it:

```json
"claudeMd": { "path": "CLAUDE-BLOCK.md", "requires": ["stage-ladder"] }
```

`path` is a markdown file at the kit root. `requires` (optional) lists item ids that must all be in the
installation for the text to apply, so a partial install never refers to a skill that is not there. The
file is validated with the kit (`agentguild validate`): it must be a regular file inside the kit (never a
symlink), non-empty, under 6,144 bytes (the block is always in context), text, and must not contain the
`agentguild` block markers. Without the field the block is the same five lines as before. The block is
regenerated between its markers on every run, so changing the file and re-running replaces the text and
a second run with no change writes nothing.
