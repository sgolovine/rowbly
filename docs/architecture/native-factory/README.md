# Native factory

The native factory runs AI agents on the Stories of a Project. A detached daemon holds one Pi
supervisor session and up to a limit of independent Pi worker sessions. The manager in the daemon
controls ownership, worker slots, worktrees, sessions, commands and recovery. The board, the metadata
and the history views work without the daemon and without Pi.

Read this page when you start a task on the factory. Then read only the sub-page that is necessary for your task.

## Parts of the factory

```
 rowbly factory start  ──spawn──►  rowbly factory watchdog  (detached)
 TUI Factory controls                    │  starts again after a crash
                                         ▼
                                   rowbly factory run  (daemon)
                                         │
                                         ├── factory manager (src/services/factory-manager/)
                                         │     ├── serial supervisor loop ── Pi supervisor session + tools
                                         │     ├── reservations and worker slots
                                         │     └── worker lifecycle ── Pi worker sessions (factory-worker/)
                                         │                                one worktree for each Story
                                         ├── ownership lock and lifecycle guard (factory-ownership/)
                                         ├── command queue and receipts (factory-control/)
                                         └── status.json, Thread metadata, logs (.rowbly/runtime/)
```

- **Daemon.** `rowbly factory start` starts a detached `rowbly factory watchdog` process. The
  watchdog starts the `rowbly factory run` daemon, and starts it again after a crash. See
  [recovery.md](recovery.md#automatic-restart-after-a-crash). `--foreground` runs the daemon code
  in the current terminal, without a watchdog (`src/commands/factory-runner/`). Close the TUI
  without a stop to leave the daemon active.
- **Supervisor.** One Pi session. Its message comes from `supervisorMessage()` in
  `src/services/messages/messages.ts`.
  It decides which Stories get a worker. It uses only the manager tools, for example
  `factory_snapshot`, `stage_get`, `classify_stage`, `story_get`, `start_worker`, `stop_worker`,
  `hold_candidate`, `release_story`, `inspect_worker`, `save_note` and `raise_attention`. It receives
  bounded worker summaries (`supervisor-digest/`), not transcripts.
- **Stage classes.** The supervisor classifies each Stage prompt as `work`, `hold` or `invalid`. Only
  `work` Stages get workers.
- **Workers.** Each worker is an independent Pi session for one Story in one Stage. It gets the first
  message from `workerMessage()` in `src/services/messages/messages.ts`. It works in one worktree for the
  Story (`worker-worktree/`). It makes canonical Project changes only through the CLI shim
  `runtime/bin/rowbly`, under the Project write lock.
- **Worker executor.** The manager runs each worker through a `WorkerExecutor`
  (`factory-manager/worker-executor.ts`). See [The worker executor](#the-worker-executor).
- **Policy.** The v1 policy rules (`factory-policy/`) decide eligibility, delays, the worker limit and
  parked Stories. The policy state is in `state.json`.
  - **Dependency gate.** The policy does not start a worker for a blocked Story. A blocked Story has one or
    more upstream Stories that are not complete. The decision is `skip`, with the reason
    `waiting for <IDs>` and the `waitingFor` list. A Story in a hold Stage keeps the reason `hold stage`.
    A blocked Story records no attempt, uses no attempt budget and is not parked. When the Story becomes
    ready, it starts with the reason `new stage stay` if it has no attempt in its current Stage stay.
    The gate does not stop a worker that runs. `start_worker` refuses a blocked Story with the error
    `Story is not eligible: waiting for <IDs>`.
  - **Launch order.** When the worker limit applies, the Stories in the Stage nearest to the last Stage
    start first. Then the Stories with more downstream Stories start first. This count includes the
    direct and the indirect downstream Stories that are not complete, each one time. Then the order of
    the board applies. Thus an upstream Story starts and goes to the main branch before its downstream
    Stories.
  - **Dependencies for the supervisor.** Each decision of `factory_snapshot` and the `story_get` result
    have the `dependsOn`, `blocks` and `waitingFor` lists. In the `story_get` result, the lists come
    before `description`, so the limit of 8192 characters does not cut them. The digest has a `blocked`
    section with an item such as `ROW-03 waits for ROW-01, ROW-02` for each blocked Story in a `work`
    Stage. The section has a maximum of 12 items. It does not wake the supervisor.
  - **Stuck upstream Story.** On each pass, the manager finds the upstream Stories of the blocked
    Stories in a `work` Stage. An upstream Story cannot progress when it is in the first Stage of the
    board, when the policy parked it, or when it is in a `hold` Stage that is not the last Stage. For
    each of these Stories, the manager sets one attention entry with the key `upstream-stuck:<ID>`.
    The text gives the reason and the downstream Stories, for example
    `ROW-04 cannot progress (in Backlog). ROW-05 waits for it.` The manager removes the entry when the
    Story can progress. The manager is the guard. The supervisor prompt rules only help the model.
  - **Pull upstream Stories.** This step is off by default. When `dependencies.pullUpstream` is
    `true`, the step runs after the policy scan and before the `upstream-stuck:` step. For each blocked
    Story in a `work` Stage, the manager finds all its upstream Stories that are not complete, also
    the indirect ones. The manager moves each of these Stories that is in the first Stage to the
    first enabled `work` Stage. It does not move a parked Story or a Story in a `hold` Stage. The
    `upstream-stuck:` entry stays for these Stories. The manager moves the Stories with `updateStory`
    inside the Project write lock, and not inside the state lock. Then it commits the moves, for
    example `chore(rowbly): move ROW-04 out of Backlog for ROW-05`. While a Git sync runs, the step
    waits for a later pass. A failure sets the attention entry `pull-upstream`, and the pass
    continues. See [pi-runtime-and-auth.md](pi-runtime-and-auth.md#pull-upstream-stories).
- **Git sync.** When the user turns it on, the factory pulls the upstream branch and pushes the
  canonical branch at an interval (`project-sync/`). See
  [runtime-and-locks.md](runtime-and-locks.md#git-sync-of-the-canonical-checkout).
- **Prompts.** Each message contains the Rowbly system prompts and the user prompts of the Project.
  Only a worker gets the Stage prompt. See [../prompts.md](../prompts.md).

## Placement

The manager places each new worker on a machine: the main machine (`local`) or a worker host. The pure
function `placeWorker` in `factory-manager/placement.ts` selects the host. The slots of each host come
from `factory-manager/host-slots.ts`. These modules do no I/O.

- **Hosts.** The manager dependency `workerHosts` gives the worker hosts, each with `id`, `maxWorkers`,
  `state` and `providers`. Without the dependency, the list is empty, and all work runs on `local`. At
  this time, production gives no worker hosts.
- **Slots.** Each host has `{ id, state, max, used, free }`. For `local`, `max` is the worker limit,
  and the state is always `connected`. For a worker host, `max` is its `maxWorkers`. `used` is the
  number of active workers on the host.
- **Policy limit.** The policy limit is the sum of `max` of the hosts that are `connected`. Without
  worker hosts, it is the worker limit.
- **Status.** `factory_snapshot`, `status.json` and the supervisor digest have a `hosts` list with the
  slots of each host. The digest shows a maximum of 12 hosts.

The function applies these rules in this order:

1. A host is eligible only if its state is `connected`, it has a free slot, and it has the provider of
   the worker model. `local` always has the provider. A worker host without a known provider list, or
   a worker model without a known provider, is not eligible.
2. When the local worktree of the Story has commits that are not on `origin`, or uncommitted changes,
   only `local` is permitted.
3. When the last worker Thread of the Story ran on host H, and H is eligible, the Story goes to H.
   When H is not eligible, the Story can go to a different host only when its old worktree is known
   to be pushed and clean. If not, the Story waits, and the result gives the reason.
4. The policy orders the other eligible hosts. A tie between two worker hosts goes to the first host
   in the list.
5. A requested host must be eligible and must agree with rules 2 and 3. The policy does not apply to
   it.

`start_worker` has an optional `host` (a string). Without a host, the placement selects one. A
refused placement, or an unknown host, gives a `ConflictError` with the reason, and the manager
creates no Thread. The manager reads the Git facts of the local worktree (`readWorktreeFacts` in
`worker-worktree/`) only when the list has a worker host. The new worker Thread and the active entry
get the selected host. The dispatch to a worker host is not available yet. Thus a placement on a
worker host gives a `ConflictError` ("Remote dispatch is not available"), and the manager creates no
Thread.

## The worker executor

The manager does not use the Pi session of a worker directly. It uses a `WorkerExecutor`. This
interface lets a different executor, for example a remote executor, run a worker.

- **Interface.** `factory-manager/worker-executor.ts` has the interface. It has these operations:
  - `launch` prepares the worktree, opens the session, prompts the worker and collects the result.
    A resume uses `launch` also. The Thread record tells if the run is new or a resume.
  - `stop` stops the worker. The manager makes the Thread `interrupted`. Shutdown and `stop_worker`
    use it.
  - `cancel` stops the worker. The manager makes the Thread `cancelled`. `cancelWorker` uses it.
  - `steer` gives a steering message to a worker. It refuses a worker that does not work now.
- **Events.** The executor sends events to the manager through `WorkerEvents`: `worktreeReady`,
  `sessionOpened`, `activity`, `resultReported`, `completed`, `failed` and `finished`. The executor
  also asks the manager for the worker message (`message`) and for the `stopping` flag. It tells the
  manager when the first prompt succeeds (`prompted`).
- **Order.** The executor waits for each event before the next step. An event that throws, for example
  `Factory is stopping`, stops the launch.
- **Manager side.** `factory-manager/worker-launch.ts` keeps the decisions: the `pending`, `stopping`
  and Stage checks, the prompt-claim check, the provider pause, the worker message and the release of
  the slot. Only the manager changes the Thread record.
- **Control.** When the session opens, the manager keeps a `WorkerControl` on the active worker.
  Cancel, stop, steer and shutdown use the control. They do not use a Pi session.
- **Local executor.** `factory-manager/local-executor.ts` runs each worker in a Pi session of the
  daemon. It holds the worktree preparation, the session, the result tool, the check tools, the
  activity timer, the collection of the result and the close of the session. It loads Pi only through
  the lazy boundary of `pi-runtime/`. The interface file does not import Pi.
- **Selection.** `FactoryDependencies.executor` gives the executor. Without a value,
  `createFactoryManager` makes the local executor. Tests give a fake executor
  (`worker-executor.test.ts`).

## Prerequisites and limits

- Native execution must have Linux, Git, local files and util-linux `flock`.
- The board, metadata and Peek stay separate from these prerequisites.
- There is no ownership guarantee across hosts, NFS, PID namespaces or copied runtime directories.
- Existing Projects do not change. There is no migration of Stories, Stages, Specs or config.
- Do not assume exactly-once shell effects. Dirty worktrees and malformed runtime files stay on disk.

## The external supervisor

Rowbly does not bundle an external factory skill now. A Project can still have an old installed copy
of the `factory` skill.

- Never run that copy and the native factory together.
- Old copies of the external skill can ignore native ownership.
- Native start preserves external active attempts. See [recovery.md](recovery.md#adopt-external-attempts).

## Map of the sub-pages

| Page                                             | Read it when …                                                                |
| ------------------------------------------------ | ----------------------------------------------------------------------------- |
| [runtime-and-locks.md](runtime-and-locks.md)     | You touch `.rowbly/runtime/`, `state.json`, factory settings or a lock.       |
| [recovery.md](recovery.md)                       | You change stop, restart, cancel, resume, recovery or external adoption.      |
| [threads-and-history.md](threads-and-history.md) | You change Thread metadata, runs, Peek or the conversation reader.            |
| [pi-runtime-and-auth.md](pi-runtime-and-auth.md) | You change a Pi import, authentication, models or factory settings.           |
| [factory-activity.md](factory-activity.md)       | You change the `▶` activity of a Story or the status line below the list.     |
| [controls.md](controls.md)                       | You change a native CLI command or a factory key in the TUI.                  |
| [checks.md](checks.md)                           | You change the check queue, `run_check`, the bash gate or the check settings. |
| [host-transport.md](host-transport.md)           | You change the SSH transport to a worker host, the handshake or its errors.   |

## Related

- [../service-layer.md](../service-layer.md#native-factory): the index of the factory modules.
- [../prompts.md](../prompts.md): the prompts and the messages of the supervisor and the workers.
- [../testing.md](../testing.md#native-factory-tests): the faux provider and daemon tests.
