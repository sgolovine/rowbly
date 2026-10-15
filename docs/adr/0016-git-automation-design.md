---
status: accepted
---

# Git automation uses reactions, the `git` capability and hook commands

_Implementation status (2026-10-15): planned. There is no Git Plugin, and the Plugin API has no `git` capability yet._

Git automation goes both ways. It is designed now and built later, together with a Git Plugin; nothing in this ADR is built yet.

**Rowbly to git.** A Git Plugin reacts to Change Sets (ADR-0012). For example, it creates a branch when a Story enters an `in_progress` Stage, or it commits `.rowbly/` after a change. It runs git only through the Plugin API's `git` capability (ADR-0009), in the repository that holds the Data Root. Command mode waits for these reactions before it exits, and the TUI does not block on them. A git failure is only a warning, because the Rowbly change is already saved. Personal choices, such as whether to create branches automatically, are kept in the Git Plugin's bag in Local State (ADR-0011).

**git to Rowbly.** The Git Plugin offers `rowbly git hook <name>` commands, such as `post-commit` or `post-merge`, that act on git events: for example, they move the Story named in a commit message, or run `rowbly doctor` after a merge. These are ordinary commands, so their changes go through the full pipeline. `rowbly git install-hooks` writes small scripts that call these commands into the hooks folder that git actually uses. It respects a `core.hooksPath` set by tools such as husky or lefthook, and it chains any hook that is already there. Git hooks are not committed, so each developer installs them.

We rejected committed hooks through `core.hooksPath`, because they would displace other hook tools. We also rejected documentation only, which leaves every developer to connect the hooks by hand.
