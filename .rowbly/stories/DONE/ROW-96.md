---
title: Send workers to worker hosts from the manager
stage: DONE
position: 15
uid: fce6c147-04e5-4ce2-991c-cb8a72c75ae0
dependsOn:
  - ROW-82
  - ROW-83
  - ROW-92
  - ROW-94
  - ROW-95
createdAt: 2026-11-16T19:45:10.132Z
updatedAt: 2026-11-16T23:26:34.822Z
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-96
pull_request: https://github.com/sgolovine/rowbly/pull/292
---

## Goal

The manager sends workers to worker hosts and follows them. When the placement of ROW-95 selects a worker host, the manager sends the copy and the worker message to the host agent, starts the run, writes the events of the host into the Thread record, applies the outbox of the host, and then completes the Thread. The Story then moves on the board in the same way as for a local worker.

Read the Spec `remote-worker-hosts`, sections "Placement", "The copy and inbound updates" and "The outbox".

## Scope

In scope:

- **A `RemoteExecutor`** (`WorkerExecutor` of ROW-82) that uses the transport (ROW-85) and the host agent (ROW-89, ROW-92). For a launch it does these steps, in this order:
  1. Builds the copy with `buildThreadCopy` (ROW-92).
  2. Asks the host for the attachment ids that are not in its cache (`host cache-missing`), and uploads each one (`host cache-put`).
  3. Gets the run paths of the host (a new hidden request command, see "Technical notes").
  4. Asks the manager for the worker message with the host paths (`events.message`).
  5. Sends `host prepare` with the Thread, the Story id, the clone, the model, the message and the copy.
  6. Writes the base of the copy (see below).
  7. Starts the host agent (`host serve --detach`) and submits a `launch` command (`host submit`). A Thread record with more than one run gives a `resume` command.
  8. Follows the `run` frames of `host attach` for the Thread until the run ends.
- **The routing of the manager.** Each worker goes to the executor of its host: `local` to the local executor, each worker host to the remote executor. `stop`, `cancel` and `steer` go to the executor of the host of the active entry.
- **The worker message.** `workerMessage()` in `src/services/messages/messages.ts` builds the message with the paths of the host: the copy as the Project root, the worktree of the host, the CLI shim of the host and the `write.lock` of the Thread in the command prefix. It stays the only place that builds the message. A remote worker gets no checks block (ROW-93 adds the checks on the host).
- **The events of the host into the Thread record.** The remote executor maps the fields of each `run` frame (`HostRunState` of ROW-92) to the `WorkerEvents` of ROW-82: worktree, session, activity and usage, result, final usage, and the end reason. The manager writes them with the existing handlers of `worker-launch.ts`.
- **The outbox before the end.** Before the manager completes a remote Thread, it applies all outbox entries of the host with `syncHostOutbox` (ROW-94). Then it examines the Story Stage, as for a local worker. While a remote Thread is active, the manager also applies the outbox of its host at each scan, so that the changes of the worker get to the board during the run.
- **`waiting for host sync`.** While a remote Thread has outbox entries that are not applied, or its final status did not arrive, the policy skips its Story with the reason `waiting for host sync`. This rule comes before all other skip and start rules of the Story.
- **The base of the copy.** For each remote Thread, the main machine keeps the copy that it sent last, in `runtime/hosts/<host>/threads/<thread-id>/base.json`. ROW-98 uses it for the inbound updates. This Story only writes it.
- **The outbox commands on the host.** `rowbly host outbox`, `rowbly host outbox-ack` and `rowbly host blob` accept the project id, so that the main machine can call them over SSH, where `ROWBLY_OUTBOX` is not set. `transportOutboxSource` (ROW-94) gives the project id.
- Documentation in STE: the dispatch to a host in `docs/architecture/native-factory/` (the executor section of `README.md` and `host-agent.md`), `waiting for host sync` where the policy skip reasons are listed, and the changed hidden commands in `docs/architecture/cli.md`.

Not in scope:

- The reconnect, the command queue of each host, the heartbeat, the host states and the recovery after a restart (ROW-97).
- The production list of worker hosts and the SSH transport of each host in the daemon (ROW-116). In this Story, the manager gets its worker hosts and the transport of each host from dependencies, and only tests give them.
- Inbound updates to a running copy (ROW-98). Abandoned Threads and held entries (ROW-99).
- Checks of remote workers (ROW-93). The session mirror, Peek and `inspect_worker` for remote Threads (ROW-101, ROW-111). The fetch of a missing attachment (ROW-110).
- The TUI.

## Acceptance criteria

- [ ] Full run: a manager test with the faux provider, the fake transport (`createFakeHostTransport`) and one injected worker host places a Story on the host, runs the worker in a host agent with a temporary home folder, and the worker moves the Story to the next Stage through the outbox. The Thread has `host: <host id>`, the worktree and the session of the host, the result and the final usage, and status `completed`. The Story is in the next Stage on the main machine. The slot of the host is free.
- [ ] Message: a test examines that the Run section of a remote worker has the copy, the worktree of the host (`<clone>-worktrees/<story-id>`) and a command prefix with the `write.lock` of the Thread, the shim of the host and `-C <copy>`. It has no checks block. A local worker gets the same message as before (the existing tests of `messages.test.ts` do not change).
- [ ] Order: a test examines that the manager applies the outbox entries of the Thread before it completes the Thread. When the outbox has a Stage move of the Story, the result has no problem "Story remains in the assigned Stage".
- [ ] Sync failure: when the outbox apply fails with a transport error after the run ended, the Thread does not complete and the policy skips its Story with `waiting for host sync`. The next scan applies the entries and completes the Thread. A test examines this.
- [ ] Final status: when the channel closes before the run ends, the Thread keeps its last status (it does not become `failed` or `interrupted`), and the policy skips its Story with `waiting for host sync`. A test examines this.
- [ ] The policy never starts a second worker on a Story whose remote Thread is not synchronized. A pure test of `factory-policy` and a manager test examine this.
- [ ] Failed run: a `run` frame with the end reason `failed` makes the Thread `failed` with the error code and message of the host. `stopped` makes it `interrupted`, and `cancelled` makes it `cancelled`. A test examines each.
- [ ] `cancelWorker` and `stop_worker` on a remote Thread submit `cancel-thread` and `stop-thread` to the host. `steerWorker` on a remote Thread gives a `ConflictError`. A test examines this.
- [ ] Base: after a launch, `runtime/hosts/<host>/threads/<thread-id>/base.json` has the files and the attachments of the copy that the host got, with mode 0600 and folders with mode 0700. A test examines this.
- [ ] Cache: the executor uploads only the attachment ids that `cache-missing` gives. A test examines this.
- [ ] `rowbly host outbox <project-id>`, `outbox-ack <project-id>` and `blob <sha256> <project-id>` (or the selected form) use the outbox of the host agent of the Project. Without the project id, `ROWBLY_OUTBOX` works as before. The CLI tests examine both forms.
- [ ] A local factory without worker hosts works as before. The existing factory manager tests pass with no change of expectations.
- [ ] The remote executor and its modules do not load Pi. `src/services/pi-runtime/import-boundary.test.ts` imports them while Pi is mocked to throw.
- [ ] No test uses real SSH or live credentials.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- **Base branch.** At the time of refinement, the worktree is on a detached `HEAD` (`346351eb`) without the merge of ROW-92 (PR #285, `6feeef30`). Make the branch `story/ROW-96`, then merge `origin/main` first, so that `src/services/thread-copy/`, `host-agent-prepare.ts`, `host-runner.ts` and `host-run-state.ts` exist.
- **Executor files.** Put the remote executor in `src/services/factory-manager/remote-executor.ts` (or a new service folder, for example `src/services/remote-executor/`), with one concern for each file: the launch steps, the channel of a host, the mapping of a `run` frame to the events. Add a test next to each file. Do not import Pi, `ssh-transport.ts` or `child_process`.
- **Executor interface** (`worker-executor.ts`). `WorkerEvents.message(worktree, model)` must take the location of the run: the root for `-C`, the shim and the lock. Add an optional argument, for example `message(worktree, model, location?)`, where `location` has `root`, `shim` and `lock`, and a flag for the checks block. The local executor keeps its call. `buildWorkerPrompt` in `worker-launch.ts` uses the location when it has one, and else the current values (`manager.paths.root`, `deps.shim`, `projectWriteLockPath`, `configuredChecks`).
- **Routing.** Today the manager has one `executor` (`FactoryDependencies.executor`, `createFactoryManager`). Add a small routing executor, or a function `executorFor(host)`, that gives the local executor for `LOCAL_HOST` and the remote executor for the other hosts. `launchWorker` uses the host of the Thread. `workerControl` in `worker-executor.ts` and the `control` of `ActiveWorker` use the host of the entry. Keep `FactoryDependencies.executor` as the override of the local executor, so that the tests of ROW-82 do not change.
- **Dependencies.** Add one optional manager dependency that gives, for a host id, the transport, the remote `rowbly` path and the clone of the Project on the host, for example `hostConnection?: (host: string) => Promise<HostConnection>`. Without it, a placement on a worker host keeps the `ConflictError` "Remote dispatch is not available" of ROW-95 (`placeStory` in `worker-placement.ts`). ROW-116 gives the production value.
- **Project id.** Use `hostProjectId(root)` of `src/services/host-project/host-paths.ts` for each remote command (`serve`, `submit`, `prepare`, `attach`, `cache-*`, the outbox commands).
- **Run paths.** The main machine does not know the home folder of the host, but `hostRunPaths` (`host-agent-paths.ts`) needs it. Add a hidden request command, for example `rowbly host run-paths <project-id>` with the input `{ threadId, storyId, clone }`, that gives `hostRunPaths` with `homedir()`. Register it in `src/commands/host/host-run-commands.ts` and in the list of hidden actions of `src/commands/register-commands/register-commands.test.ts`.
- **Model.** The host needs the model. Use `thread.model`, else the worker model of the factory settings. The placement of ROW-95 refuses a worker host when the worker model has no known provider, so the remote executor always has a model.
- **Commands.** A command for `host submit` is a `HostCommand` (`host-agent-control.ts`) with a new request id for each command. Keep the id of the launch command in the executor state, so that one launch submits one command. The command is a request call with the JSON text on stdin. Read the receipt; a `rejected` receipt is a `failed` event.
- **Channel.** Open one `host attach` channel for each host while the host has an active remote Thread, and give each `run` frame to the run of its Thread. The first frame is `hello`; compare it with `localVersions()` (`host-handshake.ts`). A frame that repeats a value (the same worktree, the same session, the same result) must not repeat the event. Keep the last values of each run in a `Store`.
- **Event mapping.** `worktree` → `worktreeReady`; `session` → `sessionOpened`; `activity` → `activity`; `result` → `resultReported`; phase `ended` → the outbox sync, then `completed(result)` for `completed`, `stopped` and `cancelled`, or `failed` with an error from `failure.code` and `failure.message` and `sessionOpened`; then `finished` with the final usage when the session opened. `stopping` of the events is not sent to the host; a factory stop sends `stop-thread`. The existing handlers already make the Thread `interrupted` after a stop and keep `cancelled` after a cancel.
- **The wait.** When the channel closes before the run ends, the launch of the remote executor waits and does not send an event. Then the Thread keeps its last status. A `stop` or `cancel` while the channel is closed ends the wait without an event. ROW-97 adds the reconnect.
- **Outbox.** Use `transportOutboxSource` (`src/services/outbox-apply/outbox-source.ts`) with the transport of the host, and `syncHostOutbox` (`src/services/factory-manager/outbox-attention.ts`). It takes the Project write lock in the `serial` order of the manager and does not take the state lock. Do not call it while you hold the state lock. A Thread is synchronized when the run ended and no entry of the host with its `threadId` stays after the sync (`entriesAfter` gives none).
- **Policy.** `evaluateScan` in `src/services/factory-policy/factory-policy.ts` is pure. Add an input to `ScanInput`, for example `hostSync?: readonly string[]` (the Story ids), and skip each Story in it with `waiting for host sync` before the dependency and the active worker rules. `scan` in `src/services/factory-manager/manager-status.ts` gives the Stories of the remote Threads that are not synchronized. Keep the set in `ManagerState`.
- **Base file.** Write it with `writeFileAtomic(..., { mode: 0o600, durable: true })` through `checkRuntimeDir` and `runtimeChild` (`src/services/runtime-files/runtime-files.ts`). Follow the pattern of `src/services/outbox-apply/host-files.ts`. The content is `{ version: 1, threadId, host, sentAt, files, attachments }`, from the `ThreadCopy` that went to the host.
- **Outbox commands.** In `src/commands/host/host.ts`, `blob`, `outbox` and `outbox-ack` read the folder from `ROWBLY_OUTBOX`. Add an optional project id that gives `hostAgentPaths(projectId).outbox`. Give the project id in `transportOutboxSource` as an optional input; without it, the commands stay as they are.
- **Story worktree field.** `assignWorktree` writes the worktree path of the host to the `worktree` field of the Story. Keep this. The placement of ROW-95 reads local worktree facts only for a path on this machine; a path that does not exist on this machine gives no facts.
- **Test host.** The full-run test needs a fake host that runs the real host services in the process. Add a test helper, for example `src/services/test-project/fake-host-agent.ts`, that answers the commands of the fake transport with the services of ROW-89, ROW-91, ROW-92 and ROW-94 in a temporary home folder: `prepareHostThread`, `submitHostCommand` and the agent loop with `createHostRunner` and a faux runtime, `runHostAttach`, the cache commands and the outbox commands. The faux worker can move the Story with the command prefix of its message, or the test can write the outbox entry as the CLI recorder does. Use a temporary Git repository as the clone, as the tests of ROW-92 do.
- **Safety.** Never take the Project write lock while you hold the state lock. Do not load Pi in the remote executor, the policy or the status paths. Services do not import `commander`, `ink` or `react`, and do not print. Follow the `rowbly-code-style` skill.

## Assumptions

- The production wiring (the real worker hosts, the SSH transport, the version install) is a separate Story, ROW-116. Reason: one pull request cannot hold the remote executor, the manager changes, the full-run test and the production wiring. The Story asks for tests with the fake transport, and ROW-95 already used an injected `workerHosts` dependency.
- The main machine gets the home folder of the host through a new hidden request command `host run-paths`. Reason: `hostRunPaths` needs the home folder, the worker message must have absolute paths, and the host must not change the message (ROW-92).
- When the channel closes during a run, the launch waits with no Thread change, and the Story waits with `waiting for host sync`. Reason: the Spec says that a disconnect does not make a remote Thread failed or interrupted, and the reconnect is ROW-97.
- The manager applies the outbox of a host at each scan while the host has an active remote Thread, and again at the end of each run. Reason: the channel of ROW-92 has no outbox frames, and a Stage move of a worker must get to the board. The end sync is the rule of the Spec; the scan sync also retries a sync that failed.
- A remote worker cannot be steered. `steerWorker` gives a `ConflictError`. Reason: the host agent has no steer command (ROW-92), and the Story does not ask for one.
- The Thread record gets no `checks` from the host. Reason: checks on the host are ROW-93.
- A resumed remote Thread gets the `resume` command on its own host. The rule that a remote Thread resumes only on its own host, and the recovery, are in ROW-97. Reason: the `resume` command exists (ROW-92), and the executor needs only the Thread record to select it.
- The base is the full `ThreadCopy` that went to the host. Reason: ROW-98 compares the canonical files with the base, and the copy is the exact set of values that the host has.
- The `waiting for host sync` rule comes before the other rules of a Story. Reason: the Spec says that the policy skips the Story while the Thread is not synchronized, and the reason must be clear in the decisions.
