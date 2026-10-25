# ADR-0026: Git Automatic Commits are a bounded first part of Git automation

**Status:** Accepted. Built. Narrows the implementation scope of ADR-0016 without changing its remaining planned design. Amended by ADR-0030 §1–§3: Git effects run in a queue outside the Data Root lock. Amended narrowly by [ADR-0034](0034-git-synchronization-publishes-recoverably.md).

**§1 Scope.** The requested Git Plugin commits saved Rowbly changes immediately or on a configurable interval, with personal author preferences. Automatic branching and Git-to-Rowbly hooks remain planned. ADR-0016's prerequisites for those features do not gate this independent subset.

**§2 Capability.** Plugins use host-owned `git.info`, `git.changed` and `git.resume`, never Node or shell commands. The host resolves the repository from the canonical Data Root, executes argv with bounded time/output and coordinates effects under its Data Root lock. A definition-level reaction observes every saved Operation. Activation can declare `requiresGit` so enable refuses a non-Git Data Root before saving configuration.

**§3 Scope and safety.** Select only paths represented in saved Change Sets. Preserve unrelated staging; refuse touched paths that already have staged changes. Local State and internal files never enter the selection. Edits by hand to selected paths are included, so a clean baseline is recommended. Suppress hooks and signing for Automatic Commits to prevent loops and interactive prompts. Failures warn and preserve pending work, with no rollback of Rowbly data.

**§4 Personal preferences and interval lifetime.** Frequency, seconds and optional author name/email live in the Plugin's Local State bag. Omitted author values use effective Git configuration. Pending paths and the first-write deadline persist under the worktree's Git directory. Timers do not keep the CLI alive. The TUI can commit when due; later CLI/TUI loads resume pending work. The maintainer explicitly selected no background daemon. Disabling the Plugin pauses pending work, and no exit flush is promised.

We rejected whole-repository staging because it could commit unrelated code. We rejected a background daemon because the maintainer chose commits while Rowbly is running. Hook installation retains ADR-0016's separate ownership and chaining requirements when implemented.
