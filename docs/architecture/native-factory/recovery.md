# Stop, resume and recovery

The native factory can stop normally, receive a cancel or resume command, or lose its owner in a
crash. This page gives the rules for each case. The rules keep the histories and the worktrees, and
they never start the same work two times on purpose.

Read this when you change stop, restart, cancel, resume, recovery or the adoption of external
attempts.

## Commands to the daemon

The CLI and the TUI send guarded commands to the daemon. `factory-control/` writes each command as an
immutable file in `runtime/control/`. The daemon writes a receipt in `runtime/receipts/`: accepted,
completed or rejected.

## Normal stop and restart

- Normal stop aborts the Pi sessions and keeps the histories and the worktrees.
- Normal stop relies on Pi abort for shell children.
- A restart waits for the stop and for the release of ownership.

## Cancel

A cancellation holds the Story and the Stage until one of these events:

- a release,
- an explicit resume,
- a material change of the Story.

## Resume and retry

A worker can resume only when all of these conditions are true:

- The factory is active.
- The Thread has a session file.
- Its Story is in the original Stage.
- The policy permits the resume.
- The original worktree is present.
- The Thread is not completed.

Each Thread has at most three runs. A resume adds a run to the same Thread. A retry uses a new Thread.

A later start lets the supervisor select eligible interrupted Threads. It does not resume all Threads
automatically.

## Recovery after owner death

After definite owner death, recovery (`factory-recovery/`) marks active runs as interrupted and
repairs missing native state projections.

- An old heartbeat does not prove death. A live or uncertain owner prevents takeover.
- Shell descendants that a crashed daemon started are not tracked.
- Do not assume exactly-once shell effects. Examine uncertain external effects before a resume.
- Dirty worktrees and malformed runtime files stay on disk.
- Before an offline repair, make sure that all relevant factory processes have stopped.

`rowbly doctor` reports corrupt and orphan Threads. It does not repair their histories or take over a
live daemon.

## Adopt external attempts

Native start preserves the active attempts of an external supervisor.

- `--adopt-external` marks these attempts as interrupted. It does not stop external workers or import
  their conversations.
- Stop the external workers before this explicit adoption.
- Never run both supervisors together. Old external skill copies do not honor native ownership.

## Related

- [runtime-and-locks.md](runtime-and-locks.md): ownership and the lock rules.
- [threads-and-history.md](threads-and-history.md): Threads and runs.
- [controls.md](controls.md): the commands and keys that send stop, cancel and resume.
