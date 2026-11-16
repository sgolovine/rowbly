---
title: Add the host agent (rowbly host serve)
stage: BACKLOG
dependsOn:
  - ROW-85
  - ROW-86
createdAt: 2026-11-16T19:45:05.891Z
updatedAt: 2026-11-16T19:45:05.891Z
worktree: null
pull_request: null
---

## Goal

Make the host agent: the `rowbly host serve` process on a worker host.

Read the Spec `remote-worker-hosts`, sections "Transport" and "Disconnects".

## Scope

In scope:

- A hidden `rowbly host serve` command. The main machine starts it detached (it continues when the SSH session stops).
- Only one host agent for each Project on a host. Use the claim protocol of `factory.lock` and the watchdog claim.
- A private runtime folder on the host for each Project, with mode 0700.
- Commands as immutable files with receipts, as in `factory-control/`. A request id makes a command that arrives two times have one effect.
- `rowbly host attach`: the long-lived channel of the transport.
- The worker limit of the full machine, for all Projects on the host. A launch that has no free slot is refused.
- The host agent stops when it has no work and its outbox is empty.

Not in scope:

- Worker execution. A later Story adds it.

## Acceptance criteria

- The host agent does not load Pi until it runs a worker.
- Tests cover the claim, the receipts, a duplicate command, the machine limit and the stop when idle.
