# Host agent

The host agent is the `rowbly host serve` process on a worker host. It runs the remote work of one
Project on that host. The code is in `src/services/host-agent/`. See the Spec `remote-worker-hosts`,
sections "Terms", "Decisions", "Transport" and "Disconnects".

The main machine starts the agent over SSH with the [host transport](host-transport.md). The main
machine sends commands to the agent and reads the state of the agent on a channel. The agent
continues when the SSH session stops.

The host agent is not the factory daemon. It does not take the Project write lock or the state lock.
It does not read or write a canonical `.rowbly/` folder, also not `<clone>/.rowbly/`. It never runs
a supervisor. Only the start of a run loads Pi.

## Modules

| File                        | Contents                                                                         |
| --------------------------- | -------------------------------------------------------------------------------- |
| `host-agent-paths.ts`       | The project id rule, the paths below `HOST_ROOT` and the folders with mode 0700. |
| `host-agent-claim.ts`       | The claim of the agent, `agent.json` and `liveAgent`.                            |
| `host-agent-control.ts`     | `submitHostCommand`, the command scan and the receipts.                          |
| `host-slots.ts`             | The machine limit and the slots of all Projects on the host.                     |
| `host-agent-work.ts`        | The `HostWorkRunner` interface and the run commands.                             |
| `host-agent-prepare.ts`     | `prepareHostThread`: the copy and `launch.json` of a Thread.                     |
| `host-agent-cache.ts`       | The attachment cache commands `cache-missing` and `cache-put`.                   |
| `host-inbound.ts`           | `applyHostInbound`: the inbound updates of a Thread and their applied `seq`.     |
| `host-agent-input.ts`       | The bounded read of stdin.                                                       |
| `host-runner.ts`            | `createHostRunner`: the real `HostWorkRunner`.                                   |
| `host-run-events.ts`        | The events of the executor that write `run.json`.                                |
| `host-run-state.ts`         | The read and the write of `run.json`.                                            |
| `host-run-executor.ts`      | The only module that loads Pi. The runner imports it when a run starts.          |
| `host-clone-update.ts`      | The fetch and the fast-forward of the clone.                                     |
| `host-checks.ts`            | The check queue of the agent and the check records of each run.                  |
| `host-agent.ts`             | `runHostAgent`: the loop of `host serve` and the stop when idle.                 |
| `host-attach.ts`            | `runHostAttach`: the frames of `host attach`.                                    |
| `host-ping.ts`              | `hostPing`: the answer of the heartbeat `host ping`.                             |
| `host-session-lines.ts`     | The read of the session files and the `session` frames of `host attach`.         |
| `host-attach-fetch.ts`      | The `attachment-request` and `attachment-failed` frames of `host attach`.        |
| `host-fetch.ts`             | The fetch request files and their failure answers.                               |
| `host-channel-mark.ts`      | The live mark of the attach channel (`channel.json`).                            |
| `host-attachment-source.ts` | The attachment source of the worker CLI: the cache, then a fetch request.        |
| `host-agent-launch.ts`      | `startHostAgent`: the detached start of `host serve --detach`.                   |

`src/commands/host/host.ts` only registers the hidden commands and calls these services.

## Remote commands

The main machine runs these commands. `<remote rowbly>` is `remoteRowblyPath(buildId)`. Each token
obeys the safe token rule of the transport. The data goes on stdin.

| Command                                                      | Call    | Input on stdin                               | Output                                        |
| ------------------------------------------------------------ | ------- | -------------------------------------------- | --------------------------------------------- |
| `[<remote rowbly>, "host", "serve", "--detach"]`             | request | `{ "projectId": "<id>", "maxWorkers": <n> }` | `{ "started": boolean, "owner": <Owner> }`    |
| `[<remote rowbly>, "host", "submit", <project-id>]`          | request | One command                                  | The current receipt, or `null`                |
| `[<remote rowbly>, "host", "attach", <project-id>]`          | channel | Frames (see "Attachment fetch")              | Frames                                        |
| `[<remote rowbly>, "host", "prepare", <project-id>]`         | request | The prepare input (32 MiB or less)           | `{ threadId, copy, files, attachments }`      |
| `[<remote rowbly>, "host", "cache-missing", <project-id>]`   | request | `{ "ids": [<attachment id>, …] }`            | `{ "missing": [<id>, …] }`                    |
| `[<remote rowbly>, "host", "cache-put", <project-id>, <id>]` | upload  | The file bytes (10 MiB or less)              | `{ id, added }`                               |
| `[<remote rowbly>, "host", "run-paths", <project-id>]`       | request | `{ threadId, storyId, clone }`               | The run paths of `hostRunPaths`               |
| `[<remote rowbly>, "host", "inbound", <project-id>]`         | request | `{ threadId, updates }` (32 MiB or less)     | `{ threadId, appliedSeq }`                    |
| `[<remote rowbly>, "host", "ping", <project-id>]`            | request | `{}`                                         | `{ protocol, rowbly, agent, slots, pending }` |
| `[<remote rowbly>, "host", "outbox", <project-id>]`          | request | `{ "afterSeq": <n> }`                        | `{ "entries": [...] }`                        |
| `[<remote rowbly>, "host", "outbox-ack", <project-id>]`      | request | `{ "seq": <n> }`                             | `{ "removed": <n>, "blobs": [...] }`          |
| `[<remote rowbly>, "host", "blob", <sha256>, <project-id>]`  | bytes   | None                                         | The bytes of the outbox file                  |

The project id is a dash-case token of 1 to 64 characters: `^[a-z0-9]+(-[a-z0-9]+)*$`. The main
machine makes it. A bad id gives `VALIDATION` before Rowbly writes a file.

The outbox commands use the outbox of the agent of the project id, because a command over SSH has no
`ROWBLY_OUTBOX`. Without the project id, they read the folder from `ROWBLY_OUTBOX`.

The remote executor of the main machine sends these commands. See
[Dispatch to a worker host](README.md#dispatch-to-a-worker-host).

## Runtime folder

All paths are below the home folder of the SSH user. Each folder that the agent makes has mode
0700. Each file that the agent writes has mode 0600.

| Path                                                       | Contents                                    |
| ---------------------------------------------------------- | ------------------------------------------- |
| `.local/share/rowbly/projects/<project-id>/agent/`         | The runtime folder of the Project.          |
| `agent/agent.lock`, `agent/agent.guard`                    | The claim of the agent.                     |
| `agent/agent.json`                                         | The state: owner, phase, start time, work.  |
| `agent/control/<request-id>.json`                          | The commands.                               |
| `agent/receipts/<request-id>.json`                         | The receipts.                               |
| `agent/outbox/`                                            | The outbox folder of the Project.           |
| `agent/logs/`                                              | The output of each detached agent.          |
| `agent/threads/<thread-id>/copy/`                          | The copy root, with `.rowbly/` in it.       |
| `agent/threads/<thread-id>/launch.json`                    | The prepared launch data.                   |
| `agent/threads/<thread-id>/run.json`                       | The run state.                              |
| `agent/threads/<thread-id>/write.lock`                     | The `flock` file of the worker CLI prefix.  |
| `agent/threads/<thread-id>/inbound-applied.json`           | The last applied inbound `seq`.             |
| `agent/runtime/sessions/<thread-id>/`                      | The Pi session files of the Thread.         |
| `agent/runtime/checks/jobs.json`, `<job id>.log`           | The check records and the check logs.       |
| `agent/attachments/<id>.png`                               | The attachment cache of the Project.        |
| `agent/bin/rowbly`                                         | The CLI shim of the workers.                |
| `agent/fetch/<id>.json`                                    | A fetch request of a worker CLI.            |
| `agent/fetch/<id>.failed.json`                             | The failure answer of a fetch request.      |
| `agent/channel.json`                                       | The live mark of the attach channel.        |
| `.local/share/rowbly/slots/limit.json`                     | The machine limit: `{ "maxWorkers": <n> }`. |
| `.local/share/rowbly/slots/<project-id>--<thread-id>.json` | One slot, with the owner of the agent.      |
| `.local/share/rowbly/slots/slots.lock`                     | The file lock of the slots.                 |

The phase in `agent.json` is `running`, `stopping` or `stopped`. The agent writes `stopped`
immediately before it releases its claim.

## Claim

Only one agent for each Project can run on a host. The agent takes the claim with `acquireOwner` on
`agent.lock` and `agent.guard`, as the factory watchdog does.

- A second agent for the same Project gives `already-running` and writes nothing.
- A claim of a dead owner is replaced. Age never proves death.
- If the holder wrote `stopped`, a new agent waits up to 5 seconds for the release.
- Agents of different Projects run at the same time.

## Detached start

`host serve --detach` does these steps:

1. It checks the input.
2. It writes the machine limit to `slots/limit.json`. The last value wins.
3. If a live agent holds the claim, it writes `{ "started": false, "owner": <Owner> }`.
4. Otherwise, it starts `rowbly host serve <project-id>` as a detached process in a new session.
   Stdin is ignored. Stdout and stderr go to a new file in `logs/`.
5. It waits until a live agent holds the claim, for a maximum of 15 seconds. Then it writes
   `{ "started": true, "owner": <Owner> }`. `started` is `false` if a different agent won the claim.
6. The new agent can run a queued `stop` and stop before step 5 sees it. Then the result is
   `started: true` with the owner in `agent.json`.
7. If no agent comes, it gives `HOST_TIMEOUT`.

`SIGTERM` and `SIGINT` stop the agent. The agent asks each work to stop, and stops when the work
ended.

## Commands and receipts

`host submit` writes the command to `control/<request-id>.json` with an exclusive create. It writes
the full file to a temporary name, syncs it, and then links it to the command path. Thus a command
file is always complete. A command file that exists does not change. Thus a command that arrives two
times has one effect. The output is the existing receipt or `null`.

`host submit` gives `VALIDATION` and writes no file for text that is not JSON, for a command without
a valid id, and for a command larger than 65536 bytes.

The request id is the id of the command: `[A-Za-z0-9_-]{1,128}`. The main machine makes it.

| Command         | Fields     | Effect                                                               |
| --------------- | ---------- | -------------------------------------------------------------------- |
| `launch`        | `threadId` | Takes a machine slot and gives the prepared Thread to the runner.    |
| `resume`        | `threadId` | As `launch`, with the session file and the worktree of the last run. |
| `stop-thread`   | `threadId` | Stops the work of the Thread. The end reason is `stopped`.           |
| `cancel-thread` | `threadId` | Stops the work of the Thread. The end reason is `cancelled`.         |
| `stop`          | None       | The agent starts no new work and stops when its work ended.          |

Each command has `version: 1`, `id` and `type`. An optional `payload` must be an object. The runner
does not read it: the data of a run comes from the prepare step. A `stop-thread` or `cancel-thread`
for a Thread without work completes with no effect.

The agent runs each command one time, in the order of the ids. It writes a durable receipt:
`accepted`, then `completed` or `rejected`. A receipt has `version`, `id`, `ownerToken`, `status`,
`threadId` and, for `rejected`, `error` with `code` and `message`.

- A bad command gets a `rejected` receipt: bad JSON, a different id in the file, a bad version, a
  bad type, a bad `threadId` or `payload`, or a file that is too large.
- The code of a `rejected` receipt is the code of the error, for example `HOST_NO_FREE_SLOT`. An
  error that is not a Rowbly error gives `COMMAND_REJECTED`.
- A command with a `completed` or `rejected` receipt does not run again, also after a restart.
- A command with only an `accepted` receipt runs again after a restart.
- A corrupt receipt stays for inspection, and its command does not run.
- A `launch` after a `stop` gets `CONFLICT`. A second `launch` for a Thread that has work also gets
  `CONFLICT`.

The agent does not remove old commands and receipts at this time.

## Machine limit

The worker limit applies to the full host, for all Projects. Each `host serve --detach` writes the
`maxWorkers` of the host record on the main machine to `slots/limit.json`. A missing limit is 0.

`acquireSlot` and `releaseSlot` run under an exclusive file lock on `slots/slots.lock`.

1. `acquireSlot` removes each slot whose owner is dead (`probeOwner`). A slot of an uncertain owner
   stays.
2. It counts the slots. If the count is equal to or more than the limit, it gives
   `HOST_NO_FREE_SLOT`. The `details` have `used` and `max`.
3. Otherwise, it writes the slot file with the owner of the agent.

A `launch` takes a slot before it starts the work. The agent releases the slot when the work ends.

## Attachment cache

The attachment cache of the Project is `agent/attachments/`. An attachment can have any file type.
The cache file is `<id>.png` for all types, for compatibility with earlier versions. The main
machine first sends `cache-missing` with the ids of the copy. Then it sends `cache-put` for each
missing id. A bad attachment id and bytes larger than 10 MiB give `VALIDATION`. An id that is in the
cache keeps its first file, because the content of an attachment never changes.

## Prepare step

A launch has two steps. A command file has a limit of 64 KiB, and the copy is larger. Thus the
main machine first sends `host prepare`, then the `launch` or `resume` command with only the
`threadId`.

The input of `host prepare` is
`{ threadId, thread, storyId, clone, model, message, copy: { files, attachments } }`.
`thread` is the Thread record. `clone` is the clone path of the host record; a relative path is
relative to the home folder. `message` is the full worker message. The host does not change it.
Each file is `{ path, content }`, and each attachment is `{ storyId, id, file }`. `file` is the
name of the attachment file, from `attachmentFileName` of the record: `<id>.png` for a PNG, else
the id with the safe extension of the name, or the id alone. The `thread-copy` service
(`buildThreadCopy`) makes the copy on the main machine. The copy files have no attachment file,
only the manifests. All attachment files go through the cache, not as text.

`prepareHostThread` checks the full input before it writes:

- Each path must be below `.rowbly/`. A path with `..`, an empty part or a `\`, an absolute path,
  `state.json*` and `runtime/` give `VALIDATION`.
- An attachment `file` that is not the id, or the id with one safe extension, gives `VALIDATION`.
- An attachment that is not in the cache gives `VALIDATION`. The `details.missing` list has the ids.
- The Thread record must be the worker Thread of the Story.
- While the Thread has a slot with a live owner, `prepare` gives `CONFLICT`. The check and the write
  hold the slot lock, so no work of the Thread starts during the write.

Then it writes the copy to a temporary folder, puts each listed attachment
file in `.rowbly/attachments/<story-id>/<file>`, and renames the folder over `copy/`. Each folder has mode
0700 and each file mode 0600. Last, it writes `launch.json` durably. A failure writes no copy. A new
`prepare` replaces the old copy. `run.json` stays.

`hostRunPaths({ home, projectId, clone, threadId, storyId })` gives the copy, the worktree
(`<clone>-worktrees/<story-id>`), the lock, the shim and the outbox of a run. The main machine does
not know the home folder of the host. Thus it gets these paths with `host run-paths`
(`hostRunPathsAnswer`), before the prepare step. It uses them to write the Run section of the worker
message.

## Worker runner

The agent gives each accepted `launch` and `resume` to a `HostWorkRunner`. `start(request)` gives a
`HostWork` with `ended`, a promise of the end of the work, `stop()` and `cancel()`.

Without a runner, a `launch` takes a slot, then gets `HOST_WORKER_UNAVAILABLE`. The agent releases
the slot. Tests use a fake runner. `host serve` writes the CLI shim and gives the real runner of
`host-runner.ts` to the agent.

For each `launch` or `resume`, the runner does these steps:

1. It reads `launch.json` and the Story from the copy. A Thread without a prepare gives
   `NOT_FOUND`. A `resume` also needs the session file and the worktree of the last `run.json` on
   the host. If one is missing, the `resume` gives `NOT_FOUND`. The agent releases the slot.
2. It runs `git -C <clone> fetch origin`, then `git -C <clone> merge --ff-only @{upstream}`, with
   `GIT_TERMINAL_PROMPT=0`. A clone that cannot fast-forward fails the run. Rowbly never resets the
   clone.
3. It reads the factory settings of the copy (`getFactorySettings({ cwd: <copy> })`). A read that
   fails fails the run.
4. It imports `host-run-executor.ts` and makes the local executor. The clone is the Git root of the
   worktrees. The copy is `ROWBLY_ROOT`. The session files go below `agent/runtime/`. The executor
   gets the check queue of the agent and the settings of the copy.
5. The executor makes the worktree `<clone>-worktrees/<story-id>` with `prepareWorkerWorktree`.
   Existing work is never reset. A `resume` keeps the worktree of the last run.
6. The executor runs the Pi session with the prepared message, the result tool and, if the copy
   has checks, the `run_check` tool and the check gate. See [Checks](#checks).

The worker shell has `ROWBLY_OUTBOX` (the outbox folder), `ROWBLY_THREAD_ID` and `ROWBLY_HOST_AGENT`
(the absolute runtime folder of the agent). Thus each CLI write of the worker goes to the copy and to
the outbox, and the CLI can get an attachment file that is not in the copy. See "Attachment fetch".

## Run state

The runner writes the events of the executor to `threads/<thread-id>/run.json`, with mode 0600.
Each event, except the activity, writes durably.

| Field                              | Value                                                        |
| ---------------------------------- | ------------------------------------------------------------ |
| `version`, `threadId`, `requestId` | The identity of the run.                                     |
| `kind`                             | `launch` or `resume`.                                        |
| `phase`                            | `starting`, `running` (after the session opened) or `ended`. |
| `worktree`                         | `{ path, branch }`.                                          |
| `session`                          | `{ model, file }`. `file` is relative to `agent/runtime/`.   |
| `activity`                         | The last activity and usage.                                 |
| `checks`                           | The last 20 checks of the worker on this host.               |
| `result`                           | The reported result.                                         |
| `usage`                            | The final usage of the session.                              |
| `failure`                          | `{ code, message, sessionOpened }`.                          |
| `endReason`, `endedAt`             | `completed`, `failed`, `stopped` or `cancelled`.             |

The end reason is `stopped` or `cancelled` after the matching command, `failed` after a failure,
and otherwise `completed`. A stop of the agent gives `stopped`. The host reports facts, not a Thread
status. The main machine maps them to the Thread status.

## Checks

The agent has one check queue (`host-checks.ts`). See [checks.md](checks.md#remote-workers).

1. After the agent takes its claim, `openHostChecks` calls `stopOrphanChecks` for
   `agent/runtime/checks/`. The process groups of a dead agent stop only while their leader has the
   recorded `/proc` start ticks. Their jobs become `cancelled`. Then it opens the queue with the
   owner token of the agent.
2. The agent gives the queue to the runner in the `checks` field of `HostLaunchRequest`.
3. When a run starts, `bindHostRun` sets the limits of the queue from the settings of the copy, and
   sends each job change of the Thread to the run. The next run of the Thread replaces it.
4. Each job change writes the `checks` list of `run.json`: job id, check key, scope, status, `HEAD`
   and duration. A final status writes durably. A `queued` or `running` status writes without a
   sync. A change after the end of the run also writes `run.json`. A `resume` keeps the list.
5. Thus the `run` frame of `host attach` sends the list when it changes, and again after a
   reconnect.
6. `stop-thread`, `cancel-thread`, a stop of the agent and the end of a worker session cancel the
   queued and running checks of the worker: SIGTERM to the process group, then SIGKILL after 5
   seconds.
7. When the agent stops, it calls `stopCheckQueue` before it writes `stopped` and releases its claim.

`HostAgentOptions.checkDeps` replaces the parts of the queue that touch the machine. Tests give
fakes. Thus no test starts a real check.

## Stop when idle

The agent stops and releases its claim when all of these conditions are true for the idle period
(default 60 seconds):

- It has no active work.
- No command is without a settled receipt.
- The outbox is empty: `outbox/outbox.jsonl` has no entry.

An open attach channel does not keep the agent alive. After a `stop` command, the agent stops when it
has no active work, without the idle period.

## Inbound updates

An inbound update is a change of the canonical files on the main machine that goes to the copy of a
running remote Thread. See [README.md](README.md#inbound-updates) for the diff and the queue of the
main machine. The `src/services/inbound/` folder has the shared types (`inbound-types.ts`), the diff
(`inbound-diff.ts`) and the apply to a copy (`inbound-apply.ts`).

`host inbound <project-id>` reads `{ threadId, updates }`. Each update has a `seq` and a `type`.
`applyHostInbound` does these steps:

1. It checks the full input before it changes a file. A bad Thread id, a bad `seq`, an unknown type,
   a bad Story ID, a bad attachment id or a bad path gives `VALIDATION`. Each path must obey
   `validateCopyPath`.
2. It reads `launch.json`. A Thread that is not prepared gives `NOT_FOUND`.
3. It holds `threads/<thread-id>/write.lock`, the `flock` file of the worker command prefix. Thus a
   worker write and an update do not change the copy at the same time.
4. It applies each update in `seq` order. It skips an update with a `seq` equal to or less than the
   value in `inbound-applied.json`. A missing file gives `0`. After each update, it writes the `seq`
   durably to that file.
5. It writes `{ threadId, appliedSeq }`. This answer is the acknowledgement.

The apply runs the services on the copy without a recorder. Thus it writes no outbox entry. The
update types have these effects on the copy:

| Type                | Effect                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------- |
| `story.update`      | A compare-and-set of each change, with the shared code of `outbox/outbox-decision.ts`. |
| `story.create`      | Writes the Story file when the copy has no Story with that ID.                         |
| `story.delete`      | Removes the Story file and the attachment folder of the Story.                         |
| `attachment.add`    | Adds the record when its id is not in the manifest, and writes `file` from the cache.  |
| `attachment.remove` | Removes the record and its file.                                                       |
| `file.put`          | Replaces the full file.                                                                |
| `file.delete`       | Removes the file.                                                                      |

For `story.update`, a value equal to `before` gets `after`. A value equal to `after` is skipped. Each
other value is a change of the worker: the value of the worker stays, and the apply records nothing.
A Story that is not in the copy skips the update. A missing Story, record or file also skips its
update, so a second send of an update has no effect. An `attachment.add` whose file is not in the
cache adds only the record. The worker then gets the file through the attachment fetch.

## Heartbeat

The main machine sends `host ping` to each worker host at a fixed interval. `hostPing` gives the
versions of `localVersions()` and the values of the `status` frame: the agent phase, the slots and the
number of pending commands. It does not start the agent and does not change a file. The main machine
compares the versions with `checkHello`. See
[README.md](README.md#disconnects-and-reconnects) for the host states.

## Reconnect

When the connection comes back, the main machine submits the queued commands again with the same
request ids. A command file that exists does not change, so a command that arrives two times has one
effect. Then it opens a new `host attach` channel. A new channel starts with no sent values, so it
sends the status, each receipt and each run state again.

## Attach channel

`host attach` is a separate process. It reads the files of the runtime folder. It does not start or
stop the agent.

1. The first frame is the hello frame of `helloFrame()`. `openHostChannel` does the handshake with it.
2. Then a `status` frame:
   `{ "type": "status", "agent": "running" | "stopping" | "stopped", "owner": <Owner> | null, "slots": { "used": <n>, "max": <n> }, "pending": <n> }`.
   `pending` is the number of commands without a settled receipt. The channel sends a new `status`
   frame when a value changes.
3. A `receipt` frame `{ "type": "receipt", "receipt": <receipt> }` for each receipt that exists when
   the channel opens, and for each new or changed receipt. A corrupt receipt gives no frame.
4. A `run` frame `{ "type": "run", "run": <run.json> }` for each Thread when the channel opens, and
   again when its `run.json` changes. A bad `run.json` gives no frame.
5. A `session` frame for the new lines of the session file of each Thread (see "Session frames").
6. An `attachment-request` frame `{ "type": "attachment-request", "storyId": "<id>", "id": "<id>" }`
   for each new fetch request (see "Attachment fetch").

In each poll, the frames have this order: status, receipts, runs, session lines, then attachment
requests. Thus the `run` frame that names a session file comes before the first `session` frame of
that file.

### Session frames

A `session` frame has the new complete lines of the session file of one Thread:

```json
{
  "type": "session",
  "threadId": "t1",
  "file": "sessions/t1/….jsonl",
  "offset": 0,
  "end": 1234,
  "lines": ["{…}", "{…}"]
}
```

- `file` is the `session.file` value of `run.json`. It is relative to the runtime folder of the
  agent (`agent/runtime/`).
- `offset` is the byte offset in the file of the first line.
- `end` is the byte offset after the newline of the last line.
- `lines` are the complete lines, without the newline, as UTF-8 text.

The channel obeys these rules:

- It reads the session file of each Thread whose `run.json` has `session.file`.
- It sends only complete lines. A line that has no newline yet waits for the next poll.
- It reads bytes, not characters. Thus the offsets are byte offsets, and a multi-byte character is
  never cut.
- When the channel opens, each session file that exists starts at its current size. The channel does
  not send the lines that were in the file before this time. A session file that the channel first
  sees after it opened starts at offset 0. The main machine reads the missing lines (ROW-101).
- If the file becomes shorter than the sent offset, or if its inode changes, the channel starts again
  at offset 0 of the file.
- The frames of one Thread are in offset order. The `offset` of a frame is the `end` of the frame
  before it.
- An encoded frame, with its newline, is not longer than `DEFAULT_LINE_LIMIT` (1 MiB). The channel
  puts lines in one frame while the frame stays in the limit, and sends more frames for the other
  lines.
- A line that is too long for one frame is not sent. The channel sends a frame with `lines: []`, the
  `offset` of that line and the `end` after its newline. The main machine reads the bytes of this gap.
- A poll reads a maximum of 4 MiB of each session file. The next polls read the remaining lines.
- A `session.file` that is absolute, that has a `..` part or that is not below the runtime folder
  gives no read and no frame.
- A missing or unreadable session file gives no frame. It does not stop the channel.

The channel keeps the read position of each file in memory. It does not write it to disk.

## Disconnects

The workers continue when the channel stops. The host never starts work without a `launch` or
`resume` command. `run.json` keeps the result until the next connection, also after the agent stops
when idle. A new channel then sends the `run` frame with the result.

The channel stops at the end of stdin. The channel reads the frames of the main machine on stdin, as
JSON lines with the limit `DEFAULT_LINE_LIMIT`. It uses only the `attachment-failed` frame. It ignores
bad frames and frames of other types.

## Attachment fetch

The copy of a Thread has the attachment files of the Story and of its upstream Stories. A worker
can also read an attachment of a different Story with `rowbly get-attachment <story> <id>`. When
the record is in the manifest of the copy but the file is not in the copy, the worker CLI gets the
file through the host agent:

1. If the cache has the file (`agent/attachments/<id>.png`), the CLI copies it into the copy
   (`.rowbly/attachments/<story-id>/<file>`) and gives that path. It writes no fetch request.
2. Else, if the attach channel is live, the CLI writes the fetch request `agent/fetch/<id>.json`
   with `{ "version": 1, "storyId": "<id>", "id": "<id>", "requestedAt": "<time>" }`. A new request
   first removes an old failure answer. The CLI then waits until the cache has the file, a failure
   answer arrives, or the time limit (`DEFAULT_ATTACHMENT_FETCH_MS`, 30 seconds) ends. It checks
   every 250 ms. Then it copies the file into the copy.
3. Else, or after a failure answer, a closed channel or the time limit, the command fails with
   `CONFLICT`. The message tells that the worker host is offline, or gives the reason of the main
   machine, and that the attachment is not available on this host.

At the end of its wait, the CLI removes the request and the failure answer. Two workers that read
the same id share one request. The upload is idempotent, because the cache keeps the first file.

The CLI finds the agent folder from `ROWBLY_HOST_AGENT`. Without this variable, or without
`ROWBLY_OUTBOX`, the CLI does not fetch, and a missing file gives `NOT_FOUND`. A local worker and
the main machine never write a fetch request.

The parts of the fetch obey these rules:

- **Channel mark.** `host attach` writes `agent/channel.json` with its process identity (an `Owner`)
  after the hello frame. It removes the mark when the channel ends, if the mark still has its token.
  The CLI treats the channel as live when the mark exists and the owner probe does not say `dead`.
  An `uncertain` probe counts as live, as for the claim of the agent, because a host without process
  identities (macOS) always gives `uncertain`.
- **Request frames.** At each poll, the channel sends one `attachment-request` frame for each open
  request that it did not send. It keeps the `requestedAt` of each sent request in memory. A new
  request of the same id gets a new frame. A new channel sends each open request again.
- **Failure frames.** The main machine sends `{ "type": "attachment-failed", "id": "<id>", "message": "<text>" }`
  when it cannot send the file. The channel writes `agent/fetch/<id>.failed.json` with `{ "message" }`,
  only when the request of the id is open.
- **Upload.** The main machine never puts the bytes in a frame, because a frame has a limit of 1 MiB
  and an attachment can have 10 MiB. It uploads the file with `cache-put`.
- **Ids.** A bad attachment id or Story id gives `VALIDATION` before a path is made. No file is
  written outside the copy, the cache or the fetch folder.

The main machine handles the request in `src/services/remote-executor/remote-attachment.ts`. It
finds the record in the canonical manifest of the named Story, reads the file and uploads it with
`host cache-put <project-id> <id>`. When the Story or the attachment does not exist, the file is
missing or larger than 10 MiB, or the upload fails, it sends `attachment-failed`. One request id
gets at most one upload at a time on each channel. The handler only reads canonical files. It does
not take the Project write lock or the state lock.

Out of scope at this time: a queue of fetch requests on the main machine while no channel is live,
the removal of old fetch request files and old cache entries, and a fetch through the read tool of
Pi.

## Tests

No test uses real SSH. The tests use a temporary home folder. The tests of the detached start and of
the hidden commands start `src/cli.ts` with the `tsx` loader, and stop each agent that they start.
