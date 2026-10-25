# Architecture decision records

Each file records one decision: what was decided, why, and what was rejected. Source comments cite them by number and section (`ADR-0019 §2`), so numbers and section numbers never change.

- To change a decision, add a new ADR that supersedes or amends the old one, and update the old one's **Status** line. Do not rewrite an accepted decision.
- Start a new ADR with `# ADR-NNNN: <the decision as a sentence>` and a `**Status:**` line, then the context, the decision and the rejected alternatives.
- Use the terms in the [glossary](../CONTEXT.md).

## Index

### Storage and the core model

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](0001-json-files-not-sqlite.md) | JSON files in a folder tree are the only storage | Accepted; amended by 0015 and 0036 |
| [0002](0002-data-root-discovery.md) | The Data Root is discovered like `.git`, with a global fallback | Accepted; amended by 0033 |
| [0003](0003-story-keys.md) | Stories are identified by sequential keys | Accepted |
| [0004](0004-epic-link-on-story.md) | The Story holds the Epic link | Superseded by 0008 |
| [0005](0005-stages-and-fields-are-configuration.md) | Stages and Custom Fields are configuration; the most specific level replaces the levels above | Accepted; amended by 0024 |
| [0006](0006-ink-owns-the-interactive-mode.md) | Ink owns the interactive mode; Clack only prompts in command mode | Accepted |
| [0007](0007-no-workspaces.md) | The Data Root is the only container; there are no Workspaces | Accepted |
| [0008](0008-no-epics.md) | There are no Epics in core | Partly superseded by 0014 |
| [0019](0019-coordinated-recoverable-commits.md) | Operations are coordinated per Data Root and committed through a recoverable journal | Accepted; amended by 0034 and 0036 |
| [0024](0024-backlog-and-done-are-fixed-stages.md) | Every Board starts with a fixed Backlog Stage and ends with a fixed Done Stage | Accepted |
| [0031](0031-per-user-settings-live-in-a-home-config.md) | Per-user settings live in a Home Config, `~/.rowblyrc.json` | Accepted; amended by 0032, extended by 0033 |
| [0032](0032-me-is-global-with-a-local-me-per-data-root.md) | Me is global, with a local Me per Data Root | Accepted |
| [0033](0033-known-data-roots-select-the-data-root.md) | Known Data Roots in the Home Config, and `--data-root`, select the Data Root | Accepted |

| [0036](0036-binary-plugin-files-use-the-commit-journal.md) | Binary Plugin files use the existing commit journal | Accepted |

### Plugins

| ADR | Decision | Status |
| --- | --- | --- |
| [0009](0009-built-in-plugins-use-only-the-plugin-api.md) | Built-in Plugins live in this repository and use only the Plugin API | Accepted |
| [0010](0010-plugins-are-turned-on-per-data-root.md) | Plugins are turned on per Data Root, and a broken Plugin is skipped | Accepted |
| [0011](0011-plugin-data-is-a-bag-per-plugin.md) | Plugin Data is a bag per Plugin, and core keeps it unchanged | Accepted; amended by 0022 |
| [0012](0012-plugins-intercept-service-operations.md) | Plugins intercept Service Layer operations through Change Sets | Accepted; amended by 0019 and 0020 |
| [0013](0013-plugin-files-live-beside-what-they-belong-to.md) | Plugin files live in a `plugins/<id>/` folder beside what they belong to | Accepted; amended by 0022 |
| [0017](0017-actions-are-tui-only.md) | Actions are TUI only | Accepted; amended by 0022 |
| [0020](0020-plugin-execution-and-data-contracts.md) | Plugin execution, data preservation and error contracts | Accepted; amended by 0022 |
| [0021](0021-plugin-format-and-compatibility-policy.md) | Plugins own their data formats; compatibility is a policy, not an engine | Accepted |
| [0028](0028-plugin-badges-can-load-from-files.md) | Plugin badges can load what they show from the Plugin's files | Accepted |
| [0029](0029-plugin-sidebars-filter-the-board.md) | A Plugin can add a Plugin Sidebar that filters the board | Accepted |

### Built-in Plugins

| ADR | Decision | Status |
| --- | --- | --- |
| [0014](0014-epics-return-as-a-built-in-plugin.md) | Epics return as a Built-in Plugin | Accepted |
| [0015](0015-specs-are-markdown-files.md) | Specs are Markdown files | Accepted; amended by 0025 |
| [0016](0016-git-automation-design.md) | Git automation uses reactions, the `git` capability and hook commands | Partially built by 0026; amended by 0024 |
| [0018](0018-comments-are-a-built-in-plugin.md) | Comments are a Built-in Plugin | Accepted; amended by 0022 |
| [0022](0022-tasks-are-a-built-in-plugin.md) | Tasks are a Built-in Plugin | Accepted |
| [0023](0023-assignees-are-a-built-in-plugin.md) | Assignees are a Built-in Plugin | Accepted; amended by 0028 and 0032 |
| [0025](0025-a-story-has-many-story-specs.md) | A Story has any number of Story Specs, each named by a slug | Accepted |
| [0026](0026-git-automatic-commits.md) | Git Automatic Commits implement a bounded subset of Git automation | Accepted; amended by 0030 |
| [0030](0030-git-work-runs-outside-the-data-root-lock.md) | Git work runs in a queue outside the Data Root lock | Accepted |

### Development

| ADR | Decision | Status |
| --- | --- | --- |
| [0027](0027-tests-guard-only-what-review-cannot-check.md) | Tests guard only what review cannot check | Accepted |

| [0034](0034-git-synchronization-publishes-recoverably.md) | Git synchronization prepares isolated merges and publishes recoverably | Accepted |

| [0037](0037-clipboard-reads-use-an-isolated-native-child.md) | Clipboard images are read by an isolated optional native child | Accepted |
