---
title: Run remote workers in the host agent
stage: BACKLOG
dependsOn:
  - ROW-82
  - ROW-88
  - ROW-89
  - ROW-90
  - ROW-91
createdAt: 2026-11-16T19:45:07.547Z
updatedAt: 2026-11-16T19:45:07.547Z
worktree: null
pull_request: null
---

## Goal

The host agent runs remote workers.

Read the Spec `remote-worker-hosts`, sections "The copy and inbound updates" and "Disconnects".

## Scope

In scope:

- A launch command with the Thread, the worker message, the model and the copy of the tracked `.rowbly/` files (with the PNG files of the Story and its upstream Stories, through the cache).
- The copy goes into the folder of the Thread. The worker command prefix uses the copy and the outbox setting.
- `git fetch` in the managed clone, then `prepareWorkerWorktree` on the host. Existing work is never reset.
- The Pi session, the result tool and the activity, through the executor interface.
- Events on the channel: Thread status, activity, usage, result and new session lines.
- Stop, cancel and resume commands. A resume uses the same session and worktree.
- When the channel stops, the workers continue. The host agent starts no new work. The results and the events wait until the next connection.
- When a worker reads a PNG that is not on the host, the host gets it from the main machine, or gives a clear error while offline.

Not in scope:

- Checks on the host. Another Story adds them.
- The dispatch from the main machine.

## Acceptance criteria

- The worker never writes the canonical `.rowbly/` of the managed clone.
- Tests use the faux provider and the fake transport. They cover a disconnect during a run.
