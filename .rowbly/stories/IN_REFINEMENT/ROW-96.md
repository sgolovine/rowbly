---
title: Send workers to worker hosts from the manager
stage: IN_REFINEMENT
position: 15
dependsOn:
  - ROW-82
  - ROW-83
  - ROW-92
  - ROW-94
  - ROW-95
createdAt: 2026-11-16T19:45:10.132Z
updatedAt: 2026-11-16T22:43:47.980Z
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-96
pull_request: null
---

## Goal

The manager sends workers to worker hosts and follows them.

Read the Spec `remote-worker-hosts`, sections "Placement", "The copy and inbound updates" and "The outbox".

## Scope

In scope:

- A `RemoteExecutor` that uses the transport and the host agent.
- `workerMessage()` in `src/services/messages/messages.ts` builds the message with the paths and the command prefix of the host. It stays the only place that builds the message.
- The manager writes the events of the host into the Thread record: status, activity, usage, checks and result.
- The manager applies all outbox entries of the Thread before it completes the Thread. Then it examines the Story Stage.
- While a remote Thread has entries that are not applied, or its final status did not arrive, the policy skips its Story with the reason `waiting for host sync`.
- The base of the copy for each remote Thread, for the inbound updates.

Not in scope:

- The reconnect, the queue and the recovery. Another Story adds them.

## Acceptance criteria

- The policy never starts a second worker on a Story whose remote Thread is not synchronized.
- Tests use the faux provider and the fake transport. They cover a full run on a host, from the launch to the Stage move.
