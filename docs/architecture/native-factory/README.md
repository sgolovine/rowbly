# Native factory

The native factory runs AI agents on the Stories of a Project. A detached daemon holds one Pi
supervisor session and up to a limit of independent Pi worker sessions. The manager in the daemon
controls ownership, worker slots, worktrees, sessions, commands and recovery. The board, the metadata
and the history views work without the daemon and without Pi.

Read this page when you start a task on the factory. Then read only the sub-page that is necessary for your task.

## Parts of the factory

```
 rowbly factory start  ──spawn──►  rowbly factory run  (detached daemon)
 TUI Factory controls                    │
                                         ├── factory manager (src/services/factory-manager/)
                                         │     ├── serial supervisor loop ── Pi supervisor session + tools
                                         │     ├── reservations and worker slots
                                         │     └── worker lifecycle ── Pi worker sessions (factory-worker/)
                                         │                                one worktree for each Story
                                         ├── ownership lock and lifecycle guard (factory-ownership/)
                                         ├── command queue and receipts (factory-control/)
                                         └── status.json, Thread metadata, logs (.rowbly/runtime/)
```

- **Daemon.** `rowbly factory start` starts a detached `rowbly factory run` process. `--foreground`
  runs the same daemon code in the current terminal (`src/commands/factory-runner/`). Close the TUI
  without a stop to leave the daemon active.
- **Supervisor.** One Pi session with the prompt in `skills/factory/references/supervisor-native.md`.
  It decides which Stories get a worker. It uses only the manager tools, for example
  `factory_snapshot`, `stage_get`, `classify_stage`, `story_get`, `start_worker`, `stop_worker`,
  `hold_candidate`, `release_story`, `inspect_worker`, `save_note` and `raise_attention`. It receives
  bounded worker summaries (`supervisor-digest/`), not transcripts.
- **Stage classes.** The supervisor classifies each Stage prompt as `work`, `hold` or `invalid`. Only
  `work` Stages get workers.
- **Workers.** Each worker is an independent Pi session for one Story in one Stage. It gets the first
  message from `skills/factory/references/worker-message-native.md`. It works in one worktree for the
  Story (`worker-worktree/`). It makes canonical Project changes only through the CLI shim
  `runtime/bin/rowbly`, under the Project write lock.
- **Policy.** The v1 policy rules (`factory-policy/`) decide eligibility, delays, the worker limit and
  parked Stories. The native factory and the external skill share these rules and `state.json`.
- **Project instructions.** Each worker gets the text of `ROWBLY.md`. The supervisor also gets it
  with each digest.

## Prerequisites and limits

- Native execution must have Linux, Git, local files and util-linux `flock`.
- The board, metadata and Peek stay separate from these prerequisites.
- There is no ownership guarantee across hosts, NFS, PID namespaces or copied runtime directories.
- Existing Projects do not change. There is no migration of Stories, Stages, Specs or config.
- Do not assume exactly-once shell effects. Dirty worktrees and malformed runtime files stay on disk.

## The external supervisor

The external factory skill (`skills/factory/`) stays available when the native factory is off.

- Never run native and external supervisors together.
- Updated external scripts refuse a live or uncertain native owner.
- Old external skill copies do not honor native ownership.
- Native start preserves external active attempts. See [recovery.md](recovery.md#adopt-external-attempts).

## Map of the sub-pages

| Page                                             | Read it when …                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------------- |
| [runtime-and-locks.md](runtime-and-locks.md)     | You touch `.rowbly/runtime/`, `state.json`, `factory.json` or a lock.     |
| [recovery.md](recovery.md)                       | You change stop, restart, cancel, resume, recovery or external adoption.  |
| [threads-and-history.md](threads-and-history.md) | You change Thread metadata, runs, Peek or the conversation reader.        |
| [pi-runtime-and-auth.md](pi-runtime-and-auth.md) | You change a Pi import, authentication, models or factory settings.       |
| [factory-activity.md](factory-activity.md)       | You change the `▶` activity of a Story or the status line below the list. |
| [controls.md](controls.md)                       | You change a native CLI command or a factory key in the TUI.              |

## Related

- [../service-layer.md](../service-layer.md#native-factory): the index of the factory modules.
- [../skills-and-stages.md](../skills-and-stages.md): the external factory skill and its scripts.
- [../testing.md](../testing.md#native-factory-tests): the faux provider and daemon tests.
