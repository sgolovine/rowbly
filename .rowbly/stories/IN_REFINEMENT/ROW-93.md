---
title: Run checks of remote workers on their host
stage: IN_REFINEMENT
position: 12
dependsOn:
  - ROW-92
createdAt: 2026-11-16T19:45:08.084Z
updatedAt: 2026-11-16T22:43:52.687Z
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-93
pull_request: null
---

## Goal

`run_check` works for remote workers. The checks run on the host of the worker.

Read the Spec `remote-worker-hosts`, section "Checks", and `docs/architecture/native-factory/checks.md`.

## Scope

In scope:

- A check queue in the host agent with the check settings of the Project, from the copy.
- The bash gate of the remote worker rejects the commands of the checks, as for a local worker.
- The check records go to the main machine on the channel, so the Thread has its `checks` list.
- Stop and cancel stop the checks of the worker. The recovery of the host agent stops orphan check process groups.

Not in scope:

- A shared check queue for the main machine and the hosts.

## Acceptance criteria

- The `/proc` process identity rules apply on the host.
- Tests cover a check on a remote worker, a cancel and a disconnect during a check.
