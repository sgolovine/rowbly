---
title: Add the host agent (rowbly host serve)
stage: DONE
position: 8
dependsOn:
  - ROW-85
  - ROW-86
createdAt: 2026-11-16T19:45:05.891Z
updatedAt: 2026-11-16T21:48:39.455Z
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-89
pull_request: https://github.com/sgolovine/rowbly/pull/280
---

## Goal

Make the host agent: the `rowbly host serve` process on a worker host. It runs the remote work of one Project on that host. The main machine starts it over SSH, sends it durable commands and reads its state on a long-lived channel (`rowbly host attach`). The host agent continues when the SSH session stops. It enforces the worker limit of the full machine, for all Projects on the host. This Story makes the frame of the host agent. Worker execution comes later (ROW-92).

Read the Spec `remote-worker-hosts`, sections "Terms", "Decisions", "Transport" and "Disconnects".

## Scope

In scope:

- **Runtime folder.** A private folder on the host for each Project: `.local/share/rowbly/projects/<project-id>/agent/` below the home folder (use `HOST_ROOT` of `src/services/host-install/host-install.ts`). Each folder that the agent makes has mode 0700, each file has mode 0600. The folder holds:
  - `agent.lock` and `agent.guard`: the claim of the host agent;
  - `agent.json`: the state of the agent (owner, phase, `startedAt`, `updatedAt`, the active work);
  - `control/<request-id>.json` and `receipts/<request-id>.json`: the commands and their receipts;
  - `outbox/`: the outbox folder of the Project (the folder that the host agent later puts in `ROWBLY_OUTBOX` of each remote worker, see ROW-90);
  - `logs/`: the output of the detached agent.
- **The claim.** Only one host agent for each Project on a host. Use `acquireOwner`, `releaseOwner` and `probeOwner` of `src/services/factory-ownership/ownership-lock.ts` on `agent.lock` and `agent.guard`, as `src/services/factory-watchdog/watchdog-claim.ts` does. A second agent for the same Project exits with no effect. A dead holder is replaced. Agents of different Projects run together.
- **`rowbly host serve` (hidden).**
  - `rowbly host serve --detach` is the command that the main machine runs with a request call (`HostTransport.request`). The input on stdin is `{ "projectId": "<id>", "maxWorkers": <n> }`. It writes the machine limit (see below), starts `rowbly host serve <project-id>` as a detached process (new session, stdin ignored, stdout and stderr to a new file in `logs/`), waits until a live agent holds the claim (a time limit of 15 seconds), and writes one JSON value to stdout: `{ "started": boolean, "owner": <Owner> }`. `started` is `false` when a live agent already held the claim. The detached process continues when the SSH session stops.
  - `rowbly host serve <project-id>` (without `--detach`) is the agent itself. It takes the claim, writes `agent.json`, runs the command scan and the idle check in a loop, and releases the claim when it stops.
- **Commands with receipts.** The main machine sends a command with a request call to the hidden command `rowbly host submit <project-id>`. The command JSON goes on stdin. The command writes `control/<request-id>.json` durably with an exclusive create, and writes the current receipt (or `null`) to stdout. The agent runs each command one time and writes a durable receipt: `accepted`, then `completed` or `rejected` with an error code and message. Follow the model of `src/services/factory-control/factory-control.ts` (validation of the id, a file size limit, a corrupt receipt stays and its command does not run again).
  - The request id is the id of the command, `[A-Za-z0-9_-]{1,128}`. The main machine makes it.
  - A command that arrives two times has one effect: a second submit with the same id does not change the file, and gives the existing receipt. A command with a settled receipt does not run again, also after a restart of the agent.
  - Command types of this Story: `launch` and `stop`. `launch` has `threadId` and a free `payload` object that ROW-92 defines. `stop` makes the agent start no new work and stop when its work is complete.
- **The machine limit.** A machine slot service for all Projects on the host, in `.local/share/rowbly/slots/` (mode 0700):
  - `slots/limit.json` holds `{ "maxWorkers": <n> }`. Each `host serve --detach` writes the value that it gets from the main machine (the `maxWorkers` of the host record in `~/.rowblyrc.json` of the main machine, ROW-84).
  - A slot is one file `slots/<project-id>--<thread-id>.json` with the owner of the agent that holds it.
  - `acquireSlot` and `releaseSlot` run under an exclusive file lock on `slots/slots.lock` (`withFileLock` of `src/services/file-lock/file-lock.ts`). `acquireSlot` first removes each slot whose owner is dead (`probeOwner`), then counts the slots. When the count is equal to or more than the limit, it refuses with a `ConflictError` that has the code `HOST_NO_FREE_SLOT`, and the used and maximum slots in `details`.
  - A `launch` command takes a slot before it starts work. A `launch` that has no free slot is rejected, and its receipt has the code `HOST_NO_FREE_SLOT`.
- **Worker runner interface.** The agent gives each accepted `launch` to a `HostWorkRunner` interface (start, stop, and a promise of the end of the work). The agent releases the slot when the work ends. This Story has no real runner: without a runner, a `launch` gets a free slot, then is rejected with the code `HOST_WORKER_UNAVAILABLE`, and the slot is released. ROW-92 adds the runner that loads Pi. Tests use a fake runner.
- **`rowbly host attach <project-id>` (hidden).** The long-lived channel of the transport. It is a separate process that reads the files of the runtime folder. It does not start or stop the agent.
  - The first frame is the hello frame (`helloFrame()` of `src/services/host-transport/host-transport.ts`), so that `openHostChannel` does the handshake.
  - Then a `status` frame: `{ "type": "status", "agent": "running" | "stopping" | "stopped", "owner": <Owner> | null, "slots": { "used": <n>, "max": <n> }, "pending": <number of commands with no settled receipt> }`. It sends a new `status` frame when a value changes.
  - A `receipt` frame `{ "type": "receipt", "receipt": <receipt> }` for each receipt that exists when the channel opens, and for each new or changed receipt.
  - The channel stops at the end of stdin (the main machine closed it, or SSH stopped). Frames that the main machine sends are ignored in this Story. Later Stories add their frames (session lines, outbox entries, acknowledgements).
- **Stop when idle.** The agent stops and releases its claim when all of these are true for an idle period (default 60 seconds, injectable in tests): no active work, no command without a settled receipt, and an empty outbox (no entries in `outbox/outbox.jsonl`). An open attach channel does not keep the agent alive. After a `stop` command, the agent stops when it has no active work, without the idle period.
- **Services and front ends.** The logic is in a new service folder `src/services/host-agent/`. `src/commands/host/host.ts` only registers the hidden `serve`, `submit` and `attach` commands and calls the services. The services do not print, prompt or exit.
- **Documentation in STE.** A new page `docs/architecture/native-factory/host-agent.md` with a link from `docs/architecture/native-factory/README.md`. Add the hidden commands to `docs/architecture/cli.md`, as for `host blob`.

Not in scope:

- Worker execution, the copy of `.rowbly/`, `git fetch`, the Pi session, the worker events on the channel, and the stop and cancel of one worker. ROW-92 adds them.
- How the main machine makes the project id, the managed clone and `host use`. ROW-88 adds them.
- The dispatch from the main machine, the heartbeat, the host states, the command queue of the main machine and the reconnect. ROW-96 and ROW-97 add them.
- The acknowledgement of outbox entries and the removal of old receipts and command files.
- Checks on the host.

## Acceptance criteria

- [ ] The host agent does not load Pi until it runs a worker. `src/services/pi-runtime/import-boundary.test.ts` imports each module of `src/services/host-agent/` while Pi is mocked to throw.
- [ ] Claim: a test starts two agents for the same Project. Only one holds the claim, and the other exits with no effect. A claim of a dead owner is replaced. Agents of two Projects hold their claims at the same time.
- [ ] Runtime folder: a test examines that the runtime folder and its subfolders have mode 0700 and the files that the agent writes have mode 0600.
- [ ] Receipts: a test submits a `stop` command and examines the `accepted` and `completed` receipts. A bad command (bad id, bad type, too large, bad JSON) gets a `rejected` receipt, and a corrupt receipt stays and its command does not run.
- [ ] Duplicate command: a test submits the same request id two times, also after a restart of the agent. The command runs one time, the file does not change, and the second submit gives the existing receipt.
- [ ] Machine limit: a test with a limit of 2 and agents of two Projects acquires 2 slots. The third `launch` is rejected with `HOST_NO_FREE_SLOT`. A slot of a dead owner is removed, and then a `launch` gets a slot. A test with a fake runner examines that the slot is released when the work ends.
- [ ] Without a runner, a `launch` is rejected with `HOST_WORKER_UNAVAILABLE`, and no slot stays.
- [ ] Stop when idle: a test with a short idle period examines that the agent stops and releases its claim when it has no work, no pending command and an empty outbox. It does not stop while the outbox has an entry, while a command is pending, or while work is active. A `stop` command stops the agent when the work ends.
- [ ] Attach: a test examines that the first frame is a hello frame that `checkHello` accepts, then a `status` frame, then a `receipt` frame for a new receipt, and that the channel ends at the end of stdin.
- [ ] `serve --detach`: a test examines the JSON result `{ started, owner }` for a first start and for an agent that already runs. The test stops each agent that it starts.
- [ ] `rowbly host --help` does not show `serve`, `submit` or `attach`. `src/commands/register-commands/register-commands.test.ts` lists them as hidden actions.
- [ ] No test uses real SSH. The tests use temporary folders for the home folder, never the home folder of the user.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- Suggested modules in `src/services/host-agent/`, each with a test next to it:
  - `host-agent-paths.ts`: the paths below `HOST_ROOT` and the creation of the folders with mode 0700. Take the home folder as an argument (default `os.homedir()`), so that tests use a temporary folder.
  - `host-agent-claim.ts`: acquire, release and read of the claim (model: `watchdog-claim.ts`).
  - `host-agent-control.ts`: submit, scan, receipts. Do not change the behaviour of `factory-control.ts`. You can move shared code to a helper only when the `factory-control` tests still pass with no change.
  - `host-slots.ts`: the machine limit and the slots.
  - `host-agent.ts`: the loop of `host serve`, the `HostWorkRunner` interface and the idle stop.
  - `host-attach.ts`: the frames of `host attach`. Use `encodeFrame`/`decodeChunk` of `src/services/host-transport/json-lines.ts` when they fit.
  - `host-agent-launch.ts`: the detached start (model: `launchDaemon` in `src/services/factory/factory-launch.ts`).
- The project id is a token `^[a-z0-9]+(-[a-z0-9]+)*$` of 1 to 64 characters. A bad id gives a `ValidationError` before a file is written.
- The remote commands are `[<remote rowbly>, "host", "serve", "--detach"]`, `[<remote rowbly>, "host", "submit", <project-id>]` and `[<remote rowbly>, "host", "attach", <project-id>]`. `remoteRowblyPath(buildId)` gives `<remote rowbly>`. All the tokens obey the safe token rule of `src/services/host-transport/ssh-transport.ts`. The data goes on stdin.
- Use `writeFileAtomic` with `durable: true` for the command, receipt, state and limit files. The outbox read uses `outboxPaths` of `src/services/outbox/outbox-file.ts`.
- The host agent is not the factory daemon. It does not take the Project write lock or the state lock, and it does not read a canonical `.rowbly/` folder. It never runs a supervisor.
- Error codes: add `HOST_NO_FREE_SLOT` and `HOST_WORKER_UNAVAILABLE` to the error classes (see `src/services/errors/` and `src/services/host-transport/host-errors.ts`).
- Tests for the CLI commands can use `runCli` with a stubbed `HOME`. Tests that start a detached process must stop it in `afterEach`.

## Assumptions

- The main machine gives the project id, and this Story only validates it as a dash-case token. Reason: ROW-88 (not done) decides the managed folder `projects/<project-id>/`, and Rowbly has no project id now.
- The main machine sends the machine limit in the input of `host serve --detach`, and the host keeps it in `slots/limit.json`. The last value wins. Reason: the limit is in `~/.rowblyrc.json` of the main machine (ROW-84), and the host has no other source.
- Slots are files with the owner of the agent, under one machine file lock, and a slot of a dead owner is removed. Reason: this reuses the existing owner probe and file lock, and a crash cannot keep a slot forever.
- Commands go through a separate request call (`host submit`), not through the attach channel. Reason: the Spec says that commands are durable files with receipts. One path is smaller, and a request call works without an open channel.
- The `launch` command has a free `payload` and has no real runner in this Story. It is rejected with `HOST_WORKER_UNAVAILABLE`. Reason: worker execution is out of scope (ROW-92), but the slot check must be testable now.
- The idle period is 60 seconds, and an open attach channel does not keep the agent alive. Reason: the agent must not stop before the first command arrives, and the Spec stops the agent when it has no work and its outbox is empty.
- `stop` is a command of the agent, not of one worker. Reason: the Spec says that `factory stop` sends a stop to each host (ROW-97 uses it). The stop of one worker comes with ROW-92.
- The removal of old receipts and command files is not in scope. Reason: the main machine must read the receipts after a reconnect (ROW-97), so their lifetime belongs to that Story.
- The Story stays one Story. Reason: the claim, commands, slots, attach and idle stop are one small runtime frame, and each part needs the others to be tested.
- `HOST_NO_FREE_SLOT` and `HOST_WORKER_UNAVAILABLE` are subclasses of `RowblyError` in `host-errors.ts`, not of `ConflictError`. Reason: `ConflictError` has the fixed code `CONFLICT`, and the Story asks for the code `HOST_NO_FREE_SLOT`.
- A rejected receipt has the code of the Rowbly error that rejected it, and `COMMAND_REJECTED` for other errors. A `launch` after a `stop`, or a second `launch` for an active Thread, gets `CONFLICT`. Reason: the main machine must see the cause of a rejection.
- `host submit` refuses text that is not JSON, has no valid id or is larger than 65536 bytes with `VALIDATION`, because such a command cannot have a file name. The agent rejects all other bad commands with a receipt.
- A missing machine limit is 0 free slots. Reason: no work must start before the main machine sends the limit.
- When the new detached agent runs a queued `stop` and stops before `serve --detach` sees it, the result is `started: true` with the owner in `agent.json`.
