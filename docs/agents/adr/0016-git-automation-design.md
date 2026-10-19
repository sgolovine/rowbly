# ADR-0016: Git automation uses reactions, the `git` capability and hook commands

**Status:** Accepted, not built. There is no Git Plugin, and the Plugin API has no `git` capability yet. Amended by ADR-0024 §5: the `in_progress` Stage Category is now `board`.

Git automation goes both ways. It is designed now and built later, together with a Git Plugin; nothing in this ADR is built yet.

**Rowbly to git.** A Git Plugin reacts to Change Sets (ADR-0012). For example, it creates a branch when a Story enters an `in_progress` Stage, or it commits `.rowbly/` after a change. It runs git only through the Plugin API's `git` capability (ADR-0009), in the repository that holds the Data Root. Command mode waits for these reactions before it exits, and the TUI does not block on them. A git failure is only a warning, because the Rowbly change is already saved. Personal choices, such as whether to create branches automatically, are kept in the Git Plugin's bag in Local State (ADR-0011).

**git to Rowbly.** The Git Plugin offers `rowbly git hook <name>` commands, such as `post-commit` or `post-merge`, that act on git events: for example, they move the Story named in a commit message, or run `rowbly doctor` after a merge. These are ordinary commands, so their changes go through the full pipeline. `rowbly git install-hooks` writes small scripts that call these commands into the hooks folder that git actually uses. It respects a `core.hooksPath` set by tools such as husky or lefthook, and it chains any hook that is already there. Git hooks are not committed, so each developer installs them.

We rejected committed hooks through `core.hooksPath`, because they would displace other hook tools. We also rejected documentation only, which leaves every developer to connect the hooks by hand.

## What the Git Plugin needs first

This ADR stays **planned**. The design stands, but the Plugin API cannot carry it yet. Ordinary Plugin commands, saved Change Sets, warning-only reactions (awaited in command mode, in the background in the TUI), Local State bag writes through a Change Set, and hook commands that call core services through the pipeline already exist. These host capabilities are missing, and the Git Plugin needs each of them before it is built:

- **Repository resolution from the Data Root.** Find the Git repository that holds the Data Root, not the one at the caller's working directory. Cover a Data Root nested in a repository, a Data Root that is the repository top, and no repository at all.
- **Structured Git execution.** A host-owned `git` capability that takes an argv array (no shell string), runs in the resolved repository, and bounds output size and run time. A Plugin still uses no Node built-in module (ADR-0009).
- **Reading local preferences.** A read of the Plugin's own bag in Local State, so a reaction can decide, for example, whether to create a branch automatically.
- **Hook installation.** A narrow service that discovers the hooks folder Git actually uses (`core.hooksPath`, or `.git/hooks`), installs, updates and removes Rowbly's hook scripts, chains an existing hook instead of replacing it, makes the script executable, and recognizes its own scripts on reinstall. It is not a general capability to write files outside `plugins/<id>/`.
- **Hook arguments and stdin.** Each supported hook defines which arguments and stdin it passes to `rowbly git hook <name>`.
- **Loop suppression.** A commit that Rowbly makes must not trigger a hook that changes Rowbly data that leads to another commit (Git → Rowbly → Git).
- **Ordering of overlapping effects.** TUI reactions run in the background, in operation order, with no cancellation or drain contract. If automatic Git effects can overlap, define their order (for example one queue per repository), and what happens on exit.
- **Stage detection by Stage Category.** "Enters an `in_progress` Stage" means a Stage whose Stage Category is `in_progress` in the effective Board configuration, not a hard-coded Stage key.

**Acceptance when scheduled:** nested Data Root, Data Root at the repository top, no Git, a different working directory; a custom `core.hooksPath`; chaining an existing hook; reinstall and ownership; hook arguments and stdin; an executable script; Story transitions with custom Stage keys; two overlapping changes; Git → Rowbly → Git loop prevention. A failed Git side effect never changes the result of the Rowbly operation that is already saved, and the person can diagnose it. The [trust model](../../plugins/trust.md) applies: a host `git` capability is a convenience for trusted code, not a confinement.
