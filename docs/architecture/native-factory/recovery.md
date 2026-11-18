# Stop, resume and recovery

The native factory can stop normally, receive a cancel or resume command, or lose its owner in a
crash. This page gives the rules for each case. The rules keep the histories and the worktrees, and
they never start the same work two times on purpose.

Read this when you change stop, restart, cancel, resume, recovery or the adoption of external
attempts.

## Remote Threads

A remote Thread runs on a worker host. Its recovery rules are different from the rules of a local
Thread. See [remote-hosts.md](remote-hosts.md) for an overview.

- A disconnect of a worker host is not an interruption. The Thread keeps its status and shows
  `connection lost`.
- Recovery after owner death does not mark remote runs interrupted. The new daemon adopts them. See
  [Adopt remote Threads at start](#adopt-remote-threads-at-start).
- A remote Thread resumes only on its own host, because its session and its worktree are there.
- A cancel while the host is offline makes the Thread abandoned. See
  [Abandoned Threads](README.md#abandoned-threads).

## Commands to the daemon

The CLI and the TUI send guarded commands to the daemon. `factory-control/` writes each command as an
immutable file in `runtime/control/`. The daemon writes a receipt in `runtime/receipts/`: accepted,
completed or rejected.

The command types are `stop`, `cancel`, `resume`, `dismiss`, `steer` and `release`:

- `cancel`, `resume` and `steer` must have a `threadId` and an `expectedRunId`.
- `dismiss` must have an `attentionKey` of 1 to 128 characters. If the key is missing, the daemon
  rejects the command.
- `release` must have a `storyId` of 1 to 128 characters. If the Story ID is missing, the daemon
  rejects the command. See [Release a parked Story](#release-a-parked-story).
- `steer` must have a `message` of 1 to 4000 characters after trim. If the message is missing, empty
  or too long, the daemon rejects the command.
- A command file is at most 32768 bytes. A `steer` message of 4000 characters fits after JSON
  escaping.

## Steering messages

A `steer` command gives a message of a person to a running worker. `steerThread(threadId, message)` in
`src/services/factory/factory.ts` trims the message, makes sure that it has 1 to 4000 characters, sends
the command and waits for the receipt. An invalid message gives `VALIDATION`. If no live daemon
exists, the function gives `CONFLICT` with the text `Factory is not running`.

`steerWorker` in `src/services/factory-manager/worker-steer.ts` does the work in the daemon:

1. In `serial`, it makes sure that the run ID and the owner token agree with the last run, that the
   Thread is in the `active` map, that the Thread status is `running` and that the worker has a Pi
   session. If one of these checks fails, the command is rejected with `ConflictError`.
2. If the Pi session is not streaming, the command is rejected with `Worker is not working now`. The
   manager does not start a new prompt, because a new prompt outside the worker run can break the
   result collection.
3. It calls `session.steer()` with the text of `steeringMessage` in `src/services/messages/messages.ts`.
   Pi gives the message to the agent after its current tool calls. The session history keeps the
   message as a user message, so Peek shows it in the conversation.

An old supervisor Thread does not take steering messages. A Thread that does not run does not take
steering messages. Use resume for such a Thread.

## Failures in the factory loop

Each pass of the factory loop does these steps in this order:

1. The scan (`reconcilePolicy`). It writes the policy decisions to the factory state.
   Then the manager sets the `upstream-stuck:<ID>` entries for the upstream Stories that cannot
   progress, and removes the other `upstream-stuck:` entries.
2. The side steps: the settings refresh (`settings`), the worker host refresh (`hosts`), the provider
   pause check (`providers`), the canonical commit (`commit`) and the start of the Git sync (`sync`).
3. The automatic resume of the Threads that wait for the network (`network-resume`). See
   [Network failures](#network-failures).
4. The dispatch of the workers (`dispatch`). See [Factory pass](README.md#factory-pass).

If the scan fails, the pass stops. The loop sets the `reconcile` attention entry, and the next scan
tries again. A scan occurs at least each 30 seconds. A pass with a successful scan removes the
`reconcile` entry.

If a step of item 2 or item 3 fails, the loop sets the attention entry of that step, and the pass continues
to the dispatch. Thus a step that fails on each pass cannot stop the workers. A step that does not fail
removes its entry. A failed settings refresh keeps the current settings. While a Git sync runs, the
commit does not run, and its entry does not change.

A dispatch error that is not a `ConflictError` sets the `dispatch` entry, and the dispatch continues
with the next Story. A `ConflictError`, for example a full host, skips only its Story and sets no entry.

The text of each entry has the error message, limited to 500 characters.

## Dismiss an attention entry

The manager keeps the attention entries in its state. The factory loop adds them. The factory loop uses
the keys `reconcile`, `settings`, `hosts`, `providers`, `commit`, `sync`, `network-resume`, `dispatch`,
`pull`, `push` and `upstream-stuck:<ID>`. An old status file can have the key `supervisor`. The manager
keeps it until you dismiss it. A successful Git pull removes the `pull` entry, and a successful push
removes the `push` entry. A pass removes an `upstream-stuck:` entry when its Story can progress. If
you dismiss an `upstream-stuck:` entry and the Story still cannot progress, the next pass adds it again.

The manager sets the key `worker:<ID>` when a worker Thread of the Story reports blockers or
problems, or fails without a network error. A later clean result of the Story removes the entry. A
pass removes the entry when the Story is deleted or is not in the Stage of its last worker Thread.
A dismissed `worker:` entry comes back only when a new Thread of the Story ends with blockers,
problems or a failure. See [Worker attention](README.md#worker-attention).

A `dismiss` removes the entry with that key, then the manager writes `status.json`. A key that
does not exist is not an error. The manager loads the attention entries from `status.json` when it
starts, so a dismissed entry does not come back after a restart. If the factory records the same key
again, the entry comes back.

`dismissFactoryAttention(key)` in `src/services/factory/factory.ts` sends the command and waits for
the receipt. It does not load Pi. You cannot dismiss the heartbeat warning, a provider pause or a
Thread file issue. The factory makes these warnings again from the live state on each snapshot.

## Normal stop and restart

- Normal stop aborts the Pi sessions and keeps the histories and the worktrees.
- Normal stop relies on Pi abort for shell children.
- Normal stop cancels the queued checks and stops the process group of each running check. See
  [checks.md](checks.md#status-stop-and-recovery).
- A restart waits for the stop and for the release of ownership.
- A normal stop also stops the watchdog. A stop does not cause an automatic restart. See
  [Automatic restart after a crash](#automatic-restart-after-a-crash).

## Cancel

A cancel also cancels the queued and running checks of the worker.

A cancellation holds the Story and the Stage until one of these events:

- an explicit resume,
- a material change of the Story.

## Release a parked Story

The policy parks a Story after the attempt limit. Other skip reasons also stop a worker for a Story in a
work Stage: `retry delay`, `launch delay` and `cancelled by user`. `rowbly factory release <story-id>`, or
the `Force assignment` Button of the Story view, releases the Story from each of these reasons. The result
is the same as a Stage round trip, for example to Backlog and back.

`releaseFactoryStory(storyId)` in `src/services/factory/factory.ts` sends the command `release-story` to the
live daemon and waits for the receipt. It does not load Pi. Without a live daemon, it gives `CONFLICT`
with the text `Factory is not running`. The receipt has `released`.

`releaseParkedStory` in `src/services/factory-manager/story-release.ts` does the work in the daemon:

1. In `serial`, it reads the Story, the Stages and the worker Threads of the Story. A Story that does not
   exist, that is not in an enabled Stage with a work prompt, or that has a pending or running Thread gives
   `released: false` with no change.
2. It calls `releaseStory` of the policy through `updateFactoryStateIfChanged`. The release takes only the
   state lock. In the lock, an attempt of the Story whose stop is not confirmed (`hasUnstoppedAttempt`)
   stops the release with `released: false` and no write. Otherwise `releaseStory` removes the `parked`,
   `nativeCancelled` and `launchFailures` entries of the Story, resets its attempt budget and marks its
   last stopped attempt as a Stage departure.
3. It calls `notify`, so that the next pass evaluates the Story. The policy gives `start` with the reason
   `new stage stay`.

The release does not change the Story file and does not move the Story.

A Stage move or a change of the Story also releases a parked Story, with no command.

## Resume and retry

A worker can resume only when all of these conditions are true:

- The factory is active.
- The Thread has a session file.
- Its Story is in the original Stage.
- The policy permits the resume.
- The original worktree is present. The main machine examines only the worktree of a local Thread.
  The host of a remote Thread examines its own worktree and session file, and refuses a resume without
  them.
- The Thread is not completed.
- The host of the Thread is `connected` and has a free slot.

A Thread resumes only on its own host (`thread.host`, else `local`), because its session and its
worktree are only on that host. The placement rules do not apply to a resume. When the host of the
Thread is not `connected`, or has no free slot, the resume gives `CONFLICT` with the reason, and the
Thread does not change. A later attempt can succeed. A different host with more free slots does not
get the resume.

Each Thread has at most three runs. A resume adds a run to the same Thread. A retry uses a new Thread.

A later start does not resume the interrupted Threads automatically. The policy gives a `retry`
decision, and the dispatch starts a new Thread. Only the network resume and the control command
`resume` add a run to an old Thread.

## Network failures

The machine can go offline, or the connection to one AI provider can fail. The factory then pauses
the provider and resumes the work when the pause ends. The code is in `src/services/factory-manager/`:
`connectivity.ts`, `network-wait.ts` and `network-resume.ts`.

### Classification

`isConnectivityError()` reads the message and the `code` of an error, and of each nested `cause`.
The error is a connectivity error when it contains one of these texts: `fetch failed`, `ECONNRESET`,
`ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`, `ETIMEDOUT`, `ENETUNREACH`, `EHOSTUNREACH`, `socket hang up`,
`network error`, `Connection error` or `terminated`. A quota error (`429`) or an authentication error
(`401`) is not a connectivity error. The classification does not load Pi.

### The network pause

When a worker fails with a connectivity error, `pausedProviders()` gives the
provider a pause with the reason `network`:

- The first network pause of a provider has a retry time of now plus 1 minute.
- Each later network pause in a row doubles the delay, to a maximum of 15 minutes.
- While a network pause holds, a new failure of the same provider does not change the pause. The
  workers of one outage fail at about the same time, and they must not make the delay longer.
- The pause has the field `failures`, the count of network pauses in a row. The manager also keeps
  the count in `networkFailures` of `status.json`, so that the count stays after the pause ends and
  after a daemon restart.
- A successful prompt of the provider removes its count. The next pause starts at 1 minute again.

While the pause holds, the manager starts no new worker on the provider. Workers on other providers
continue. The problem list of the
factory controls shows `Provider <id> is paused (network) until <time>.`

### The failed Thread

A worker that fails with a connectivity error gets the status `failed` and this error:
`{ class: "transient", code: "NETWORK", message, retryAt }`. `retryAt` is the end of the pause. The
Thread is resumable when it has a session file. Other failures keep the class `unknown` or `launch`
and the code `WORKER_FAILED`.

A failure does not count against the attempt budget of a Story. Thus a connectivity error does not
park a Story.

### Automatic resume

On each pass, after the provider pause check, the manager resumes each `NETWORK` Thread when the
pause of its provider has ended. The Thread must be the last worker Thread of its Story, and it must
agree with the conditions of [Resume and retry](#resume-and-retry). The resume adds a new run to the
same Thread and the same Pi session. It uses a generated request ID. It does not need a person. If the resume cannot start now, for example because all
worker slots are full, the next pass tries again.

A remote `NETWORK` Thread resumes on its own host, only while that host is `connected`. While the host
is not `connected`, the manager does not try the resume. The next pass after the host is `connected`
again resumes it. The manager does not examine the worktree of a remote Thread on the main machine.

While the manager can resume a `NETWORK` Thread, the scan skips its Story with the reason
`waiting for network resume`. Thus the policy does not start a new Thread for the Story. If the
Thread cannot resume (no session file, three runs, a Stage move or no worktree), the normal policy
retry applies.

### Connectivity in the status

The factory status (`status.json` and `rowbly factory status --json`) has the field `connectivity`.
The providers are those of the worker model and the worker overrides of the factory settings.

| Value      | Condition                                     |
| ---------- | --------------------------------------------- |
| `online`   | No provider has a `network` pause.            |
| `degraded` | One or more providers have a `network` pause. |
| `offline`  | Each provider has a `network` pause.          |

The factory does not send a network probe. The first request to the provider after the pause ends
is the probe. Pi does not retry a request (`retry: { enabled: false }`).

## Automatic restart after a crash

`rowbly factory start` starts a detached watchdog, the hidden command `rowbly factory watchdog`. The
watchdog starts `rowbly factory run` as its child and watches the exit of the child. The watchdog
loop is in `src/commands/factory-runner/watchdog-runner.ts`. The pure rules and the state file are in
`src/services/factory-watchdog/`.

- A crash is a non-zero exit code, a signal or a launch error, without a stop request.
- An exit with code 0 is not a crash. This includes a stop command and the `already-running` result
  of `factory run`. After an exit with code 0, the watchdog does not start the daemon again, and it
  exits.
- After a crash, the watchdog waits, then it starts the daemon again. The wait increases with each
  crash in a row: 1 s, 2 s, 4 s, 8 s, 16 s.
- When a daemon stays up for 5 minutes, the count of crashes in a row goes back to 0.
- After 5 crashes in a row, the watchdog does not start the daemon again, and it exits. The factory
  phase is `failed`. The status has the attention entry `watchdog:crash-limit`. Its text has the last
  exit code or signal and the path of the last log. You cannot dismiss this entry, because no daemon
  is live. The next `rowbly factory start` clears it.
- The back-off, the crash limit and the stable period are constants. They are not settings.
- Each restart uses the usual start path of `factory run`: the owner probe, the recovery after owner
  death and the release of ownership. Thus recovery marks the active local runs of the crashed daemon
  as interrupted. The new daemon adopts the active remote runs. See
  [Adopt remote Threads at start](#adopt-remote-threads-at-start).
- Before each start, the watchdog probes the owner. If the owner is alive or uncertain, the watchdog
  does not start a daemon. It records the problem in its state file and exits.
- The watchdog never takes ownership. The daemon is the owner in `factory.lock`.
- Only one watchdog runs for a Project. Each watchdog takes the exclusive watchdog claim before it
  starts a daemon. A watchdog without the claim exits with `already-running`. See
  [runtime-and-locks.md](runtime-and-locks.md#the-watchdog-claim).
- The watchdog does not load Pi.
- If the watchdog dies, nothing starts it again. A reboot of the machine does not start the factory.

`rowbly factory status` and the TUI factory screen show the count of crashes in a row (`restarts`) and
the time of the last crash (`lastCrashAt`). During a back-off, the phase is `starting`.

### Stop and start with a watchdog

- `factory stop` with a live daemon sends the stop command. The daemon exits with code 0, so the
  watchdog also exits. The stop waits until the watchdog releases its claim.
- `factory stop` during a back-off sends `SIGTERM` to the watchdog. First it compares the process
  identity of the watchdog with `watchdog.json`. The watchdog cancels its timer, does not start a
  daemon, writes the phase `stopped` and exits. If the identity is uncertain, the stop fails with
  `CONFLICT`.
- `factory start` does not start a second watchdog while a live watchdog waits in its back-off. It
  waits for the daemon of that watchdog.
- Many `factory start` commands at the same time start only one daemon. Each start can launch a
  watchdog, but only the watchdog with the claim continues. The other starts wait for its daemon.
- `factory start` after the `failed` phase starts a new watchdog. The new watchdog sets the count to 0.
  It keeps the time and the exit of the last crash.

## Recovery after owner death

After definite owner death, recovery (`factory-recovery/`) marks active local runs as interrupted and
repairs missing native state projections.

- A local Thread becomes `interrupted` with the error code `OWNER_DIED`.
- A worker Thread whose `host` is a worker host (not `local`) keeps its status (`pending` or
  `running`) and gets no error. Its run can continue on the host. Recovery still repairs its
  projection. The new daemon adopts it.
- Recovery first interrupts the local Threads of the dead owner. Then it repairs the projections of
  all Threads in one state transaction. It reads `state.json` one time and writes it a maximum of one
  time. If no attempt changes, recovery does not write the file, and `updatedAt` stays the same.
- Recovery examines the owner token under the state lock, before the write. If the token changed,
  recovery stops with a `ConflictError` and does not write `state.json`.
- The write is atomic. After a crash, the next recovery repairs the projections again. Each attempt
  has its Thread ID, so a repeated repair does not add a duplicate attempt.

- An old heartbeat does not prove death. A live or uncertain owner prevents takeover.
- Shell descendants that a crashed daemon started are not tracked. Check processes are an exception.
  Recovery stops each check process group whose leader still has the recorded start ticks.
- Do not assume exactly-once shell effects. Examine uncertain external effects before a resume.
- Dirty worktrees and malformed runtime files stay on disk.
- Before an offline repair, make sure that all relevant factory processes have stopped.

`rowbly doctor` reports corrupt and orphan Threads. It does not repair their histories or take over a
live daemon.

## Adopt remote Threads at start

A remote run continues on its worker host while the daemon is off. Before the first factory pass,
the new daemon adopts each worker Thread with the status `pending` or `running` on a worker host
(`factory-manager/worker-adopt.ts`). For each Thread, it does these steps:

1. It gives the last run of the Thread to the new owner (`adoptThreadRun`). It does not add a run,
   because a new run is a resume.
2. It registers the active worker on the host of the Thread. The Thread uses one slot of its host,
   and the placement of a new worker counts it.
3. It puts the Story in the `hostSync` set. The policy skips the Story with the reason
   `waiting for host sync`.
4. It follows the run with `adopt` of the remote executor. It sends no new `launch` or `resume`
   command. The reconnect of the host gets the run state with `host runs`. See
   [host-agent.md](host-agent.md#reconnect-of-adopted-runs).

The run then ends as usual: the outbox sync, then one `completed` or `failed` event. Then the manager
frees the slot and removes the Story from the `hostSync` set. The adopted run does not send
`worktreeReady` or `sessionOpened` again for a value that the Thread already has. A result, an
activity and the end that arrived while the daemon was off still go to the manager.

- A queued `launch` or `resume` of the Thread in `runtime/hosts/<host>/commands.json` gives the
  request id of the adopted run. The reconnect sends it as usual.
- When the host is offline at start, the Thread keeps its status, and its Story waits. The heartbeat
  does the reconnect when the host is `connected` again.
- When the host has no run for the Thread, and the queue has no `launch` or `resume` for it, the
  Thread becomes `failed` with the error code `HOST_RUN_MISSING`. Its slot becomes free. The normal
  retry rules apply to the Story.
- Only a manager with remote dispatch (`hostConnection`) adopts. Without it, a remote Thread of a
  dead owner keeps its status.
- A Thread whose Story does not exist is not adopted. It keeps its status.

## Adopt external attempts

Rowbly does not bundle an external factory skill now. A Project can still have an old installed copy
of the `factory` skill. Native start preserves the active attempts of that external skill.

- `--adopt-external` marks these attempts as interrupted. It does not stop external workers or import
  their conversations.
- Stop the external workers before this explicit adoption.
- Never run the external skill and the native factory together. Old copies of the external skill can ignore native ownership.

## Related

- [runtime-and-locks.md](runtime-and-locks.md): ownership and the lock rules.
- [threads-and-history.md](threads-and-history.md): Threads and runs.
- [controls.md](controls.md): the commands and keys that send stop, cancel and resume.
