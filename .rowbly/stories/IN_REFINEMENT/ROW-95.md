---
title: Add the placement setting and host worker slots
stage: IN_REFINEMENT
position: 14
dependsOn:
  - ROW-83
  - ROW-84
createdAt: 2026-11-16T19:45:09.575Z
updatedAt: 2026-11-16T20:06:55.620Z
worktree: null
pull_request: null
---

## Goal

The manager places each worker on a machine. The user selects the placement policy in the factory settings.

Read the Spec `remote-worker-hosts`, section "Placement".

## Scope

In scope:

- A `placement` key in the `factory` settings: `prefer-local` (default), `most-free` or `prefer-remote`. `getFactorySettings` gives the default. A write keeps the other keys.
- Worker slots for each host: `maxWorkers` for `local`, and the limit of each worker host that is on for the Project.
- A pure placement function: the policy, the free slots, the host state, the provider of the worker model, the affinity of a Story to the host of its worktree, and the rule that a Story with commits that are not pushed or a dirty local worktree stays on the main machine.
- `start_worker` accepts an optional host. Without a host, the manager decides.
- The digest and `factory_snapshot` show the slots of each host.

Not in scope:

- The dispatch to a remote host.
- The control in the TUI Settings. Another Story adds it.

## Acceptance criteria

- With no worker hosts, the behavior is the same as now.
- Tests cover each policy, a tie, a disconnected host, the affinity and the unpushed-work rule.
