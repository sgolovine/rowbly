---
title: Share one factory status read across TUI views
stage: BACKLOG
worktree: null
pull_request: null
---

## Problem

The TUI reads the factory status in many ways at the same time:

- `useFactoryChanges` reads it again on a 5 s timer.
- It also reads it again on each write of `runtime/status.json` and `runtime/factory.lock`.
- The supervisor writes `status.json` on a 5 s heartbeat and on each change.

Each read of `getFactoryStatus` reads the owner lock, probes the process in `/proc`, validates the runtime paths and parses `status.json`. More than one open view does this work separately.

## Proposed fix

- Share one factory status source in the TUI, so all views get one read for each change.
- Skip the timer read when a file event came during the last poll period.
- Cache the process identity of the owner for its PID, so a probe does not read `/proc` again for the same live process.

## Acceptance

- With the Factory view and the Threads tab open, one status write causes one status read.
- A factory that stops without a file write still shows as stopped in under 10 s.
