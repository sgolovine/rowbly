---
title: Record the host of each worker Thread and attempt
stage: IN_REFINEMENT
position: 2
createdAt: 2026-11-16T19:45:01.623Z
updatedAt: 2026-11-16T20:06:49.327Z
worktree: null
pull_request: null
---

## Goal

Each worker Thread and each policy attempt records the machine that runs it. The value is `local` for all current work.

Read the Spec `remote-worker-hosts` for the full design.

## Scope

In scope:

- A `host` field on `ThreadRecord` (`src/services/thread/`) and on the attempts in `state.json` (`src/services/factory-policy/policy-types.ts`). A record without the field reads as `local`.
- The manager keeps the host on each active worker entry.
- `factory-activity/` gives the host with the activity of a Story.
- `rowbly thread` and `rowbly factory status --json` show the host.

Not in scope:

- Remote hosts, placement or TUI changes.

## Acceptance criteria

- Old Thread files and old `state.json` files read without an error and give `local`.
- `factory-state/` keeps unknown v1 keys, as before.
- Tests cover the old and the new format.
