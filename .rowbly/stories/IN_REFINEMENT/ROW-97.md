---
title: Survive worker host disconnects and reconnects
stage: IN_REFINEMENT
position: 16
dependsOn:
  - ROW-96
createdAt: 2026-11-16T19:45:10.683Z
updatedAt: 2026-11-16T20:06:56.684Z
worktree: null
pull_request: null
---

## Goal

The factory continues correctly when a worker host disconnects and reconnects.

Read the Spec `remote-worker-hosts`, section "Disconnects".

## Scope

In scope:

- A heartbeat to each host and the host states `connected`, `degraded`, `disconnected`, `version-mismatch` and `auth-failed`.
- A disconnect does not change the status of a remote Thread to failed or interrupted.
- A queue of commands for each host. On reconnect, the stop and cancel commands go first. Then the main machine reads the run states, the results, the session lines and the outbox.
- The recovery after the death of the local owner does not mark remote runs as interrupted. At start, the daemon asks each host for its runs.
- A remote Thread resumes only on its own host.
- `factory stop` sends a stop to each host and waits for each connected host. A stop is not an abandon.
- The automatic network resume of `NETWORK` Threads works for remote Threads on their host.

Not in scope:

- Abandoned Threads, the status in the UI and inbound updates. Other Stories add them.

## Acceptance criteria

- Tests use the fake transport. They cut the connection at each step of a run and examine that each result arrives one time.
