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
  `factory_snapshot`, `story_get`, `start_worker`, `stop_worker`,
  `hold_candidate`, `release_story`, `inspect_worker`, `save_note` and `raise_attention`. It receives
  bounded worker summaries (`supervisor-digest/`), not transcripts.
- **Stage classes.** The manager gives each Stage the class `work`, `hold` or `invalid` with a fixed
  rule (`factory-settings/stage-classes.ts`). Only `work` Stages get workers. The rule has this order:
  1. The class of the Stage in the setting `factory.stageClasses` (`work` or `hold`).
  2. `invalid` for a Stage with an empty prompt (only white space).
  3. `hold` for the first Stage and the last Stage of `stages` in `rowbly.config.json`.
  4. `work` for all other Stages.

  Thus a new Stage with a prompt gets workers at once. The manager does not read or write the
  `prompts` key of `state.json`. An old `state.json` with this key stays valid.
- **Workers.** Each worker is an independent Pi session for one Story in one Stage. It gets the first
  message from `workerMessage()` in `src/services/messages/messages.ts`. It works in one worktree for the
  Story (`worker-worktree/`). It makes canonical Project changes only through the CLI shim
  `runtime/bin/rowbly`, under the Project write lock.
- **Worker executor.** The manager runs each worker through a `WorkerExecutor`
  (`factory-manager/worker-executor.ts`). See [The worker executor](#the-worker-executor).
- **Policy.** The v1 policy rules (`factory-policy/`) decide eligibility, delays, the worker limit and
  parked Stories. The policy state is in `state.json`.
  - **Host sync.** The policy skips a Story whose remote worker Thread is not synchronized, with the
    reason `waiting for host sync`. This rule comes before all other rules of the Story. See
    [Dispatch to a worker host](#dispatch-to-a-worker-host).
  - **Dependency gate.** The policy does not start a worker for a blocked Story. A blocked Story has one or
    more upstream Stories that are not complete. The decision is `skip`, with the reason
    `waiting for <IDs>` and the `waitingFor` list. A Story in a hold Stage keeps the reason `hold stage`.
    A blocked Story records no attempt, uses no attempt budget and is not parked. When the Story becomes
    ready, it starts with the reason `new stage stay` if it has no attempt in its current Stage stay.
    The gate does not stop a worker that runs. `start_worker` refuses a blocked Story with the error
    `Story is not eligible: waiting for <IDs>`.
  - **Story references.** An attempt in `state.json` has `story` (the Story ID) and `storyUid` (the
    `uid` of the Story), when the Story has a `uid`. A decision also has `storyUid`. The policy finds
    the Story of an attempt by the rule of `matchStoryRef`. See [Story references](#story-references).
    An old attempt without `storyUid` stays valid. A `storyUid` that is not a string makes `state.json`
    invalid.
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

## Story references

Some records of the factory keep a reference to a Story: the attempts in `state.json`, the worker
Threads and the outbox entries of a remote worker host. The attachment records also keep one. A
reference has the Story ID and, when the Story has one, the Story `uid`. The `uid` does not change
when the number of the Story changes. See [../storage.md](../storage.md).

- A new record gets `storyUid` from its Story. A Story without a `uid` gives a record without
  `storyUid`. Rowbly does not add `storyUid` to old records.
- `matchStoryRef(stories, { id, uid })` in `src/services/story/story-ref.ts` finds the Story of a
  reference. It is a pure function. The Story with the `uid` of the reference comes first. If the
  reference has no `uid`, or no Story has it, the Story with the ID comes next.
- `resolveStoryRef({ id, uid })` in the Story service reads the Story files and applies the same rule.
  It gives `NOT_FOUND` when no Story matches.
- These reads use the rule: the outbox apply, the match of attempts to a Story in the policy
  (`factory-policy/`), `releaseStory` and the Story filter of `listThreads`.
- `dependsOn` lists, the Story links of Specs and the attachment folder names keep only the Story ID.

## Placement

The manager places each new worker on a machine: the main machine (`local`) or a worker host. The pure
function `placeWorker` in `factory-manager/placement.ts` selects the host. The slots of each host come
from `factory-manager/host-slots.ts`. These modules do no I/O.

- **Hosts.** The manager dependency `workerHosts` gives the worker hosts, each with `id`, `maxWorkers`,
  `state` and `providers`. Without the dependency, the list is empty, and all work runs on `local`.
  The daemon gets the dependency from `createWorkerHostSource` in `worker-hosts/`. See
  "Worker hosts of the registry".
- **Slots.** Each host has `{ id, state, max, used, free }`. For `local`, `max` is the worker limit,
  and the state is always `connected`. For a worker host, `max` is its `maxWorkers`. `used` is the
  number of active workers on the host.
- **Policy limit.** The policy limit is the sum of `max` of the hosts that are `connected`. Without
  worker hosts, it is the worker limit.
- **Status.** `factory_snapshot`, `status.json` and the supervisor digest have a `hosts` list with the
  slots of each host. The digest shows a maximum of 12 hosts.
- **Contact facts.** In `factory_snapshot` and `status.json`, the entry of a worker host also has
  `lastSeenAt` (ISO text) and `latencyMs` from the heartbeat facts, when the heartbeat has them. The
  `state` is the heartbeat state or `not-ready`. `local` has no `lastSeenAt` and no `latencyMs`. The
  digest does not have these two fields, because they change at each heartbeat.

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
get the selected host. A manager without the dependency `hostConnection` cannot send a worker to a
worker host. Then a placement on a worker host gives a `ConflictError` ("Remote dispatch is not
available"), and the manager creates no Thread. With `hostConnection`, the manager sends the worker
to the host. See [Dispatch to a worker host](#dispatch-to-a-worker-host).

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
- **Remote executor.** `remote-executor/` runs each worker of a worker host in the host agent of
  that host. It does not load Pi, and it does not start a process. See
  [Dispatch to a worker host](#dispatch-to-a-worker-host).
- **Selection.** `FactoryDependencies.executor` gives the local executor. Without a value,
  `createFactoryManager` makes the local executor. Tests give a fake executor
  (`worker-executor.test.ts`). The manager makes the remote executor only when it has the dependency
  `hostConnection`.
- **Routing.** `executorFor(manager, host)` in `factory-manager/remote-dispatch.ts` gives the executor
  of a host: the local executor for `local`, and the remote executor for each worker host. The launch
  uses the host of the Thread. The control of the active worker, and thus `stop`, `cancel` and `steer`,
  uses the host of the active entry.
- **Message location.** `message(worktree, model, location)` has an optional location: the Project
  root of `-C`, the CLI shim, the lock of the command prefix and the checks flag. Without a location,
  the message has the canonical Project root, the shim of the daemon, the Project write lock and the
  configured checks.
- **Stop reason.** `completed(result, stop)` has an optional stop reason. `stopped` makes the Thread
  `interrupted`, and `cancelled` makes it `cancelled`. The local executor does not send it.

## Worker hosts of the registry

`createWorkerHostSource(ctx, deps)` in `src/services/worker-hosts/` makes the manager dependencies
`workerHosts` and `hostConnection` from the host registry in `~/.rowblyrc.json`. `rowbly factory run`
gives them to the manager. The service only reads the file. It does not record `lastCheck`.

- **List.** `workerHosts()` gives one view for each host that is on and that has a record for the
  current Project. `maxWorkers` comes from the registry.
- **Check.** The check of a host runs in the background. It does these steps:
  1. `ensureHostVersion` installs the exact Rowbly build when the host has a different version. If
     the version stays different, the state is `version-mismatch`.
  2. `quickHostCheck` checks the version and the Pi providers. If the host is ready, the state is
     `connected` with the providers of the check. Otherwise, the state is `not-ready`.
  3. A transport failure or a different error gives `disconnected`.
- **Interval.** `workerHosts()` does not wait for SSH. It gives the result of the last check at once.
  A host without a completed check is `not-ready`. When the last check is older than the check interval
  (60 seconds), and no check of the host runs, the call starts a new check. The checks of different
  hosts run in parallel. A host that is off, or that leaves the list, loses its last check. When it
  comes back, it gets a new check.
- **Build and transport.** The source gets the local build one time, and only when a host needs it. It
  makes one SSH transport for each host, and uses it again for each check and each connection.

## Dispatch to a worker host

When the placement selects a worker host, the remote executor sends the worker to the host agent of
that host. See [host-agent.md](host-agent.md) and the Spec `remote-worker-hosts`, sections
"Placement", "The copy and inbound updates" and "The outbox".

- **Connection.** The manager dependency `hostConnection(host)` gives the transport, the path of
  `rowbly` on the host and the clone of the Project on the host. The daemon gets it from
  `createWorkerHostSource`. It also gives the connection of a host that is off, so that the active
  remote Threads of that host can complete and sync.
  Each remote command uses the project id `hostProjectId(root)`.
- **Launch.** The remote executor does these steps, in this order:
  1. It builds the copy of the `.rowbly/` files with `buildThreadCopy`.
  2. It sends `host cache-missing`, and it uploads only the missing attachment files with
     `host cache-put`.
  3. It gets the run paths of the host with `host run-paths`.
  4. It asks the manager for the worker message with the paths of the host.
  5. It sends `host prepare` with the Thread, the Story, the clone, the model, the message and the copy.
  6. It writes the base of the copy (see below).
  7. It starts the host agent with `host serve --detach`. Then it submits a `launch` command with
     `host submit`. A Thread with more than one run gets a `resume` command.
  8. It follows the `run` frames of the Thread on the `host attach` channel until the run ends.
- **Model.** The model is the model of the Thread, else the worker model of the factory settings.
- **Message.** The Run section of a remote worker has the copy as the Project root, the worktree of
  the host (`<clone>-worktrees/<story-id>`), and a command prefix with the `write.lock` of the Thread,
  the shim of the host and `-C <copy>`. It has no checks block.
- **Channel.** The executor opens one `host attach` channel for each host with an active remote run.
  The host must send a hello frame with the same versions. The channel gives each `run` frame to the
  run of its Thread. Only the frames of the `launch` or `resume` command of the run apply. A
  `rejected` receipt of that command fails the run. The channel closes when the host has no active
  remote run.
- **Events.** The executor maps the fields of each `run` frame to the events of the manager:
  `worktree` to `worktreeReady`, `session` to `sessionOpened`, `activity` to `activity` and `result`
  to `resultReported`. A frame that repeats a value sends no event. The end has these events:
  1. The outbox sync of the host, then the catch-up of the session mirror.
  2. `completed` for the end reasons `completed`, `stopped` and `cancelled`, or `failed` with the code
     and the message of the host. The Thread error keeps the code of the host.
  3. `finished` with the final usage, when the session opened.
- **Outbox.** Before the manager completes a remote Thread, it applies all outbox entries of the host
  with `syncHostOutbox` and `transportOutboxSource`. Thus a Stage move of the worker is on the board
  before the manager examines the Story Stage. On each scan (`reconcilePolicy`), the manager also
  applies the outbox of each host with an active remote Thread. The scan does not apply the outbox of a
  host while a run of the host has no open session, because the Stage checks of the session must see
  the Story before the worker changes it. A failed sync sets the attention entry `host-sync:<host>`.
- **Sync failure.** When the sync after the end fails, the Thread does not complete. The next scan
  applies the entries and completes the Thread.
- **Disconnect.** When the channel closes before the run ends, the launch waits without an event.
  The Thread keeps its last status. It does not become `failed` or `interrupted`. See
  [Disconnects and reconnects](#disconnects-and-reconnects).
- **Controls.** `stop` submits `stop-thread`, and `cancel` submits `cancel-thread`. When the host has
  no open channel, or the submit fails in the transport, the command goes in the queue of the host. A
  remote worker
  cannot get a steering message: `steer` gives a `ConflictError`. The manager keeps the control on the
  active worker from the start of the launch, so that a stop reaches the host also before the session
  opens.
- **Host sync.** While a remote Thread has outbox entries that are not applied, or its final status
  did not arrive, the Story is in the `hostSync` set of the manager state. The policy skips it with
  the reason `waiting for host sync`. This rule comes before all other skip and start rules of the
  Story. The manager removes the Story from the set when the launch of the remote executor ends.
- **Base of the copy.** For each remote Thread, the main machine keeps the copy that it sent last in
  `runtime/hosts/<host>/threads/<thread-id>/base.json`: `{ version, threadId, host, sentAt, files,
  attachments }`. The file has mode 0600, and its folders have mode 0700. The inbound updates use it.
- **Session mirror.** The main machine keeps a copy of the session file of each remote Thread. See
  [Session mirror](#session-mirror).

## Session mirror

The main machine keeps a byte-exact copy of the complete lines of the session file of each remote
Thread (`remote-executor/session-mirror.ts`). See the Spec `remote-worker-hosts`, section "Session
mirror".

- **Path.** The mirror path is the `session.file` value of the Thread
  (`sessions/<thread-id>/<name>.jsonl`), below the local runtime folder. Thus the `conversation/`
  service, `rowbly thread log`, `inspect_worker` and Peek read the mirror as a local session file. They
  work also while the host is offline, with the lines that arrived before the cut.
- **Live lines.** The channel gives each `session` frame to the mirror of its Thread, but only when the
  Thread is an active run of the same host. The pure function `frameStep(size, frame)` compares the
  frame with the size of the mirror file:
  - When `end` is at or before the mirror end, the mirror skips the frame. Thus a line that arrives two
    times is in the mirror one time.
  - When the frame starts at or before the mirror end, the mirror adds only the bytes after the mirror
    end. The lines are UTF-8, each with a newline. The offsets are byte offsets.
  - When the frame starts after the mirror end, or it is a gap frame of a long line (`lines: []`), the
    mirror does a catch-up first. Then it applies the frame again. When the catch-up fails, the mirror
    drops the frame. The mirror never has a gap.
- **Catch-up.** The mirror reads the bytes after its end from the host with
  `rowbly host session-bytes`, one window at a time, until the answer is empty (see
  [host-agent.md](host-agent.md#session-bytes)). The executor does a catch-up for a gap, after a
  reconnect for each open run with a session, and before the end event of a run. Thus the last lines
  of a run are in the mirror when the Thread completes. A catch-up failure does not stop the reconnect,
  the outbox sync or the end of the run. A later catch-up adds the bytes.
- **One write at a time.** The executor keeps one chain of writes for each Thread (`mirrors` in the
  state of the executor). Thus a live frame and a catch-up never write at the same time.
- **Files.** The mirror files have mode 0600, and their folders have mode 0700. The mirror appends to
  the file. It does not write a full copy for each frame. A mirror write takes no Project write lock
  and no state lock. A new session file of the Thread gets a new mirror file, and the old file stays.
  The mirror files stay after the Thread ends.
- **Pi.** The mirror and `host session-bytes` do not load Pi.

## Inbound updates

A remote worker works on a copy of the canonical `.rowbly/` files. The main machine sends each later
change of the canonical files to the copy of each running remote Thread as an inbound update. See
the Spec `remote-worker-hosts`, section "The copy and inbound updates", and
[host-agent.md](host-agent.md#inbound-updates) for the apply on the host.

- **Diff.** In `syncHosts` (`remote-executor/remote-sync.ts`), after the outbox sync of a host, the
  executor compares the canonical files with the base of each open run (`remote-inbound.ts`). It
  reads the canonical files with `buildThreadCopy` under the Project write lock, through the input
  function `readLocked`. The manager runs it in its lifecycle order. It does not take the state lock.
  The outbox goes first, so a change of the worker that is on the main machine now gives an update
  with no effect.
- **Update types.** The pure function `inboundDiff` (`inbound/inbound-diff.ts`) gives the updates. A
  Story is identified by its ID, not by its path, because a Stage move changes the path.

  | Type                | Body                              | Source of the update                                     |
  | ------------------- | --------------------------------- | -------------------------------------------------------- |
  | `story.update`      | `{ storyId, storyUid?, changes }` | `storyChanges()` of the base and the canonical Story.    |
  | `story.create`      | `{ storyId, path, content }`      | A Story that is not in the base.                         |
  | `story.delete`      | `{ storyId }`                     | A Story that is not in the canonical files.              |
  | `attachment.add`    | `{ storyId, attachment, file? }`  | A record that is not in the base manifest.               |
  | `attachment.remove` | `{ storyId, id }`                 | A record that is not in the canonical manifest.          |
  | `file.put`          | `{ path, content }`               | Each other text file of the copy, new or changed.        |
  | `file.delete`       | `{ path }`                        | Each other text file that is not in the canonical files. |

  The order is: the other files (the config can add a field or a Stage), new Stories, changed
  Stories, attachments, deleted Stories. An `attachment.add` of the Story of the Thread or of an
  upstream Story has `file`. Before the send, the executor uploads that file with `cache-missing`,
  then `cache-put` for a missing id.
- **Queue.** The updates of a Thread go in
  `runtime/hosts/<host>/threads/<thread-id>/inbound.json` first:
  `{ version: 1, nextSeq, updates: [{ seq, type, ...body }] }`. Then the base gets the current values.
  A crash between the two writes makes the same updates again with new `seq` values, and they have no
  effect. The file has mode 0600, and its folders have mode 0700 (`remote-executor/inbound-queue.ts`).
- **Sequence numbers.** The inbound `seq` of each Thread is separate from the outbox `seq`. It starts
  at 1 and only increases. A new `prepare` of the Thread removes the waiting updates, but `nextSeq`
  stays. The end of a run also removes its waiting updates.
- **Send and acknowledgement.** The executor sends the waiting updates with `host inbound`. The
  answer is the last applied `seq` of the host. The updates with that `seq` or less leave the queue.
  When an answer is lost, the next send gives the same updates again, and the host skips them. A
  Thread that is not prepared on the host (`NOT_FOUND`) loses its waiting updates.
- **Failures.** A transport error keeps the updates in the queue and gives no problem. The heartbeat
  and the reconnect send them later. A refusal of the host (`HostProtocolError`) keeps the updates and
  gives the problem of the host, so that the manager sets `host-sync:<host>`.

## Disconnects and reconnects

The factory continues when a worker host disconnects and connects again while the daemon runs. See
the Spec `remote-worker-hosts`, section "Disconnects".

- **Heartbeat.** The manager sends a heartbeat to each worker host of `workerHosts` with the state
  `connected`. A heartbeat is one `rowbly host ping <project-id>` request. The host gives its versions
  and the status values of its agent. The manager starts the heartbeat only when it has
  `hostConnection` and `workerHosts`. The heartbeat has its own timer
  (`factory-manager/host-heartbeat.ts`), not the supervisor loop. It takes no Project write lock and no
  state lock. `stopFactory` stops it. The defaults are: interval 15 seconds, request time limit 10
  seconds, latency limit 5 seconds. Tests give the interval and the clock with the dependency
  `hostHeartbeat`.
- **Host states.** The pure function `nextHostState` in `remote-executor/remote-heartbeat.ts` gives
  the state after each heartbeat:

  | State              | Condition                                                            |
  | ------------------ | -------------------------------------------------------------------- |
  | `connected`        | The heartbeat succeeded with a latency of 5 seconds or less.         |
  | `degraded`         | One or two failed heartbeats in a row, or a latency above 5 seconds. |
  | `disconnected`     | Three or more failed heartbeats in a row.                            |
  | `version-mismatch` | A `HostVersionMismatchError`, or the host gives different versions.  |
  | `auth-failed`      | A `HostAuthFailedError`.                                             |

  The manager keeps the state, `lastSeenAt` and the latency of each host in `hostHealth` of the
  manager state. The state that the manager uses is the state of `workerHosts` when it is not
  `connected`, else the heartbeat state. Before the first heartbeat, it is the state of `workerHosts`.
  `workerHosts` can also give `not-ready`. Only a `connected` host gets new work.
- **Attention.** When the heartbeat gives a worker host the state `disconnected`, `version-mismatch`
  or `auth-failed`, the manager sets the attention entry `host:<id>`. The text gives the host, the
  state and the last contact time, or `never`. When the heartbeat gives the host `connected` or
  `degraded` again, the manager removes the entry. The 5-second status timer writes the change to
  `status.json`. An old `host:<id>` entry of a previous daemon goes away at the first good heartbeat.
- **Connection lost.** `rowbly thread list`, `rowbly thread show` and `rowbly status` show the remote
  Threads whose host is not `connected` or `degraded`. See [cli.md](../cli.md#connection-lost).
- **No failure on a disconnect.** A disconnect does not change the status of a remote Thread. The
  launch waits, and the Story keeps the reason `waiting for host sync`.
- **Cut during the launch.** A transport error before the `launch` or `resume` command has a request
  id fails the launch with the error code of the host, for example `HOST_UNREACHABLE`. It is never
  `NETWORK`, and it does not pause the provider of the model. After the request id is set, a transport
  error of the submit does not fail the run. The same command, with the same request id, goes in the
  queue, and the run waits. The host agent gives one effect for a request id that arrives two times.
- **Command queue.** A command that cannot go to the host waits in
  `runtime/hosts/<host>/commands.json` (`remote-executor/host-command-queue.ts`). Each command keeps
  its request id. A command leaves the queue only after the host gave its receipt for the submit. A
  stop or a cancel of a Thread removes the queued `launch` or `resume` of that Thread. Then the wait of
  that run ends, because the main machine cannot know if the run started.
- **Stop and cancel.** A `stop` while the host is disconnected goes in the queue, and the run keeps its
  wait until the reconnect. A `cancel` while the host is disconnected goes in the queue, and the wait
  ends. The Thread keeps its last status.
- **Reconnect.** When the heartbeat of a host gives `connected`, the manager calls `reconnect(host)` of
  the remote executor (`remote-executor/remote-reconnect.ts`). When the host has queued commands,
  waiting inbound updates, an active run without a channel, or a run that waits for the sync, the
  executor does these steps:
  1. It submits each queued `stop-thread` and `cancel-thread`, in the order of arrival. Then it
     submits the other queued commands.
  2. It sends the waiting inbound updates of each active run. See [Inbound updates](#inbound-updates).
  3. It opens the `host attach` channel again for the active runs. The host sends the status, each
     receipt and the run state of each Thread again. The run state stays across channels, so a value
     that was sent before sends no event.
  4. It reads the session lines that the host wrote while it was offline, for each open run with a
     session (see [Session mirror](#session-mirror)). A failure does not stop the next step.
  5. It applies the outbox of the host with `syncHosts`.

  Thus a run that ended on the host while it was offline completes one time.
- **Factory stop.** `stopFactory` calls `shutdown` of the remote executor before it waits for the
  active workers. For each active remote run, a host with an open channel gets `stop-thread`, and the
  run ends as usual, with the outbox sync. For a host without a channel, `stop-thread` goes in the
  queue and the wait of the run ends at once. The wait has a time limit of 60 seconds (the dependency
  `remoteStopTimeoutMs`). After the limit, the wait of each run ends. A stop is not an abandon: the
  outbox entries that the host wrote before the stop are applied as usual.
- **Not in this Story.** The recovery after a restart of the daemon, the resume of a remote Thread
  only on its own host and the network resume of remote Threads come with ROW-117.

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
| [host-install.md](host-install.md)               | You change the Node check or the install of Rowbly on a worker host.          |
| [host-check.md](host-check.md)                   | You change `rowbly host check`, the short check or `rowbly host login`.       |
| [host-agent.md](host-agent.md)                   | You change the host agent, its commands, the machine slots or `host attach`.  |

## Related

- [../service-layer.md](../service-layer.md#native-factory): the index of the factory modules.
- [../prompts.md](../prompts.md): the prompts and the messages of the supervisor and the workers.
- [../testing.md](../testing.md#native-factory-tests): the faux provider and daemon tests.
