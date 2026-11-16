# Host agent

The host agent is the `rowbly host serve` process on a worker host. It runs the remote work of one
Project on that host. The code is in `src/services/host-agent/`. See the Spec `remote-worker-hosts`,
sections "Terms", "Decisions", "Transport" and "Disconnects".

The main machine starts the agent over SSH with the [host transport](host-transport.md). The main
machine sends commands to the agent and reads the state of the agent on a channel. The agent
continues when the SSH session stops.

The host agent is not the factory daemon. It does not take the Project write lock or the state lock.
It does not read a canonical `.rowbly/` folder. It never runs a supervisor. It does not load Pi.

At this time, the agent has no worker runner. ROW-92 adds the runner that loads Pi.

## Modules

| File                    | Contents                                                                         |
| ----------------------- | -------------------------------------------------------------------------------- |
| `host-agent-paths.ts`   | The project id rule, the paths below `HOST_ROOT` and the folders with mode 0700. |
| `host-agent-claim.ts`   | The claim of the agent, `agent.json` and `liveAgent`.                            |
| `host-agent-control.ts` | `submitHostCommand`, the command scan and the receipts.                          |
| `host-slots.ts`         | The machine limit and the slots of all Projects on the host.                     |
| `host-agent-work.ts`    | The `HostWorkRunner` interface and the `launch` and `stop` commands.             |
| `host-agent.ts`         | `runHostAgent`: the loop of `host serve` and the stop when idle.                 |
| `host-attach.ts`        | `runHostAttach`: the frames of `host attach`.                                    |
| `host-agent-launch.ts`  | `startHostAgent`: the detached start of `host serve --detach`.                   |

`src/commands/host/host.ts` only registers the hidden commands and calls these services.

## Remote commands

The main machine runs these commands. `<remote rowbly>` is `remoteRowblyPath(buildId)`. Each token
obeys the safe token rule of the transport. The data goes on stdin.

| Command                                             | Call    | Input on stdin                               | Output                                     |
| --------------------------------------------------- | ------- | -------------------------------------------- | ------------------------------------------ |
| `[<remote rowbly>, "host", "serve", "--detach"]`    | request | `{ "projectId": "<id>", "maxWorkers": <n> }` | `{ "started": boolean, "owner": <Owner> }` |
| `[<remote rowbly>, "host", "submit", <project-id>]` | request | One command                                  | The current receipt, or `null`             |
| `[<remote rowbly>, "host", "attach", <project-id>]` | channel | Frames (ignored at this time)                | Frames                                     |

The project id is a dash-case token of 1 to 64 characters: `^[a-z0-9]+(-[a-z0-9]+)*$`. The main
machine makes it. A bad id gives `VALIDATION` before Rowbly writes a file.

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

| Command  | Fields                                | Effect                                                      |
| -------- | ------------------------------------- | ----------------------------------------------------------- |
| `launch` | `threadId`, optional `payload` object | Takes a machine slot and gives the work to the runner.      |
| `stop`   | None                                  | The agent starts no new work and stops when its work ended. |

Each command has `version: 1`, `id` and `type`. ROW-92 defines the `payload`.

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

## Worker runner

The agent gives each accepted `launch` to a `HostWorkRunner`. `start(request)` gives a `HostWork`
with `ended`, a promise of the end of the work, and `stop()`.

Without a runner, a `launch` takes a slot, then gets `HOST_WORKER_UNAVAILABLE`. The agent releases
the slot. Tests use a fake runner.

## Stop when idle

The agent stops and releases its claim when all of these conditions are true for the idle period
(default 60 seconds):

- It has no active work.
- No command is without a settled receipt.
- The outbox is empty: `outbox/outbox.jsonl` has no entry.

An open attach channel does not keep the agent alive. After a `stop` command, the agent stops when it
has no active work, without the idle period.

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

The channel stops at the end of stdin. At this time, the frames that the main machine sends are
ignored. Later Stories add their frames.

## Tests

No test uses real SSH. The tests use a temporary home folder. The tests of the detached start and of
the hidden commands start `src/cli.ts` with the `tsx` loader, and stop each agent that they start.
