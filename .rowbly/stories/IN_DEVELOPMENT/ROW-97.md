---
title: Survive worker host disconnects and reconnects
stage: IN_DEVELOPMENT
position: 16
uid: 46c3414b-e2fd-43af-95d5-cbfee713f080
dependsOn:
  - ROW-96
createdAt: 2026-11-16T19:45:10.683Z
updatedAt: 2026-11-16T23:48:57.156Z
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-97
pull_request: https://github.com/sgolovine/rowbly/pull/296
---

## Goal

The factory continues correctly when a worker host disconnects and reconnects while the daemon runs. A disconnect does not fail a remote Thread. Stop and cancel commands are not lost. When the host returns, the main machine gets each run state, result and outbox entry of the host one time.

Read the Spec `remote-worker-hosts`, section "Disconnects".

## Scope

In scope:

- **A heartbeat** to each worker host of the manager, and the host states `connected`, `degraded`, `disconnected`, `version-mismatch` and `auth-failed`. Only a `connected` host gets new work.
- **No failure on a disconnect.** A disconnect does not change the status of a remote Thread to `failed` or `interrupted`. The Thread keeps its last status. Its launch task waits.
- **A queue of commands for each host.** `stop-thread` and `cancel-thread` commands that cannot go to the host wait in a durable queue. On reconnect, the queued stop and cancel commands go first. Then the main machine opens the `host attach` channel again, reads the run states and the results, and applies the outbox.
- **Reconnect.** When the heartbeat of a host succeeds again and the host has active remote runs or queued commands, the main machine does the reconnect steps above. A run that ended on the host while it was offline completes one time.
- **`factory stop`** sends `stop-thread` for each active remote Thread. It waits for the end of each run on a connected host, with a time limit. For a host that is not connected, the stop goes into the queue and the daemon does not wait. A stop is not an abandon: outbox entries that the host wrote before the stop are applied as usual.
- Documentation in STE: the heartbeat, the host states, the queue and the reconnect in `docs/architecture/native-factory/` (the executor section of `README.md` and `host-agent.md`), the queue file in the file tree of `runtime-and-locks.md`, and the new hidden command in `docs/architecture/cli.md`.

Not in scope:

- The recovery after a restart of the daemon (do not mark remote runs interrupted, ask each host for its runs at start), the rule that a remote Thread resumes only on its own host, and the automatic network resume of remote `NETWORK` Threads. ROW-117 adds them.
- Abandoned Threads and held entries (ROW-99). A cancel while the host is offline only puts `cancel-thread` in the queue here.
- Inbound updates (ROW-98). The queue of this Story is for stop and cancel commands. ROW-98 adds its updates.
- The `hosts` list in `status.json`, the `host:<id>` attention entry and `connection lost` in the status (ROW-100). The session mirror (ROW-101). The TUI.
- The production list of worker hosts and the SSH transport in the daemon (ROW-116).

## Acceptance criteria

- [ ] Cut at each step: a manager test with the faux provider, the fake transport (`createFakeHostTransport`) and one injected worker host cuts the connection (`disconnect()`) and restores it (`reconnect()`) at each of these steps of a run: during the `launch` submit (the host gets the command but the answer is lost), after the `launch` submit, after the worktree frame, after the session frame, after the result frame, after the end frame and before the outbox sync, and during the outbox sync. For each step, the Thread ends one time with the correct status, `resultReported` and `completed` (or `failed`) are each called one time, the Story is in the next Stage one time, and each outbox entry is applied one time.
- [ ] Cut before the submit: a cut after `prepare` and before the `launch` submit fails the Thread one time with the error code of the host error (not `NETWORK`), and no run starts on the host. A test examines this.
- [ ] Disconnect during a run: the Thread keeps its status (`running`) while the host is disconnected. It does not become `failed` or `interrupted`. The Story waits with `waiting for host sync`. A test examines this.
- [ ] Heartbeat states: a pure test of the state function examines each state: `connected` after a good heartbeat; `degraded` after one or two failed heartbeats in a row, or a latency above the limit; `disconnected` after three failed heartbeats in a row; `version-mismatch` for a `HostVersionMismatchError` or a different version; `auth-failed` for a `HostAuthFailedError`.
- [ ] Placement: a host in a state other than `connected` gets no new worker. A test examines `degraded`, `disconnected`, `version-mismatch` and `auth-failed`.
- [ ] Queue order: a `stop_worker` or a cancel while the host is disconnected writes the command to the queue file. On reconnect, a test examines that the transport gets the queued `stop-thread` or `cancel-thread` before the new `host attach` channel opens.
- [ ] Queue durability: the queue file is `runtime/hosts/<host>/commands.json`, with mode 0600 in folders with mode 0700. A command leaves the queue only after the host gives its receipt. A command that is sent two times (the same request id) has one effect on the host. A test examines this.
- [ ] Factory stop: with one connected host, `factory stop` submits `stop-thread` and waits until the run ends; the Thread becomes `interrupted`, and an outbox entry that the host wrote before the stop is applied. With one disconnected host, `factory stop` puts `stop-thread` in the queue and completes without a wait; the Thread keeps its status. A test examines both cases.
- [ ] A local factory without worker hosts works as before. The existing factory manager tests pass with no change of expectations.
- [ ] The heartbeat, the queue and the reconnect modules do not load Pi. `src/services/pi-runtime/import-boundary.test.ts` imports them while Pi is mocked to throw.
- [ ] No test uses real SSH or live credentials. Tests inject the heartbeat interval and the clock.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- **Base branch.** At the time of refinement, the worktree is on a detached `HEAD` (`b419a4da`) without the merge of ROW-96 (PR #292, `50c2da9e`). Make the branch `story/ROW-97`, then merge `origin/main` first, so that `src/services/remote-executor/` and `src/services/factory-manager/remote-dispatch.ts` exist.
- **Existing code (ROW-96).** `src/services/remote-executor/remote-executor.ts` runs the launch steps. `remote-channel.ts` keeps one `host attach` channel (`HostLink`) for each host, and `markClosed` removes it when it closes. `remote-run.ts` keeps the state of each run in a `Store<RemoteRunState>`: `sent` (the values that were sent), `ended`, `closed`, `commandId`. `newFacts` in `run-frames.ts` drops a value that was already sent. Thus a run frame that arrives again after a reconnect does not repeat an event. Keep the run state across channels; only the channel is new.
- **The host sends all states again.** `runHostAttach` (`src/services/host-agent/host-attach.ts`) starts each new channel with empty `sent` values. Thus a new channel sends the status, each receipt and the run state of each Thread again. The reconnect does not need a new host command to read the runs.
- **Today's gap.** In `stopRemote`, a stop or cancel without an open channel calls `endWait`, and the command never goes to the host. Replace this with the queue. Keep `endWait` only for the cases in "Factory stop" and for a cancel (ROW-99 completes the cancel case).
- **Heartbeat.** Add a hidden request command `rowbly host ping <project-id>` (register it in `src/commands/host/host-run-commands.ts` and in the list of hidden actions of `src/commands/register-commands/register-commands.test.ts`). It gives `{ protocol, rowbly }` from `localVersions()` and the `StatusFrame` values of the agent (agent phase, slots). It does not start the agent. The main machine compares the versions with `checkHello` (`host-handshake.ts`). Put the heartbeat in a new file, for example `src/services/remote-executor/remote-heartbeat.ts`, with a pure function `nextHostState(previous, outcome)` and a test next to it. Defaults: interval 15 seconds, request time limit 10 seconds, latency limit 5 seconds, `disconnected` after 3 failures in a row. Tests inject the interval and the clock.
- **Host states.** `HostState` in `src/services/factory-manager/host-slots.ts` becomes `connected | degraded | disconnected | version-mismatch | auth-failed | not-ready`. Rename `wrong-version` to `version-mismatch` in all uses. The state that the manager uses is the state of `workerHosts()` when it is not `connected`, else the state of the heartbeat. Before the first heartbeat of a host, use the state of `workerHosts()`. Keep the heartbeat state of each host in `ManagerState`, with `lastSeenAt` and the latency, so that ROW-100 can show them. `placement.ts` already gives work only to `connected` hosts.
- **Where the heartbeat runs.** The manager starts the heartbeat loop only when it has `hostConnection` and worker hosts. Run it on its own timer, not in the supervisor loop, and stop it in `stopFactory` (`factory-shutdown.ts`) in the same way as `state.heartbeat`. A heartbeat does not take the Project write lock or the state lock.
- **Queue file.** Write `runtime/hosts/<host>/commands.json` with `writeFileAtomic(..., { mode: 0o600, durable: true })` through `checkRuntimeDir` and `runtimeChild`, as in `src/services/outbox-apply/host-files.ts`. Content: `{ version: 1, commands: [{ id, type, threadId, queuedAt }] }`. Each command keeps its request id, so a second send has one effect on the host (the host agent already keeps receipts by request id). The order on reconnect: all `stop-thread` and `cancel-thread` commands in the order of arrival, then the attach channel, then `syncHosts`. ROW-98 adds the inbound updates after the stop and cancel commands.
- **A cut during the launch steps.** A transport error before the `launch` command has a request id (during the copy, the cache, `run-paths`, `prepare` or `serve`) fails the launch with the existing error path (`failRun`). Do not give it the code `NETWORK`: `isConnectivityError` (`connectivity.ts`) is for the provider, and a `NETWORK` failure pauses the provider of the model. Keep the error code of the host error, for example the code of `HostUnreachableError`. After the request id is set, a transport error of the submit does not fail the run: the executor puts the same `launch` or `resume` command (the same request id) in the queue and waits. The host agent gives one effect for a request id that arrives two times.
- **Factory stop.** Add a method to the remote executor, for example `shutdown(timeoutMs)`, and call it from `stopFactory` before the wait for the active tasks. For each active run: when its host is `connected`, submit `stop-thread` and let the run end normally (with the outbox sync); else put `stop-thread` in the queue and call `endWait`. After the time limit (default 60 seconds, injectable), call `endWait` on each run that did not end. Do not call `syncHostOutbox` while the state lock is held.
- **Outbox.** Use the existing `syncHosts` of the remote executor after each reconnect. It takes the Project write lock and does not take the state lock.
- **Safety.** Never take the Project write lock while you hold the state lock. Do not load Pi in the remote executor, the heartbeat or the status paths. Services do not import `commander`, `ink` or `react`, and do not print. Follow the `rowbly-code-style` skill. Use `.js` extensions in relative imports.

## Assumptions

- The Story is split. ROW-117 has the recovery after a restart, the resume only on the own host and the network resume of remote Threads. Reason: one pull request cannot hold the heartbeat, the queue, the reconnect, the factory stop and the restart recovery with their tests. The reconnect while the daemon runs is the first part with a result of its own.
- The heartbeat is a new hidden request command `rowbly host ping`. Reason: the `host attach` channel sends frames only when a value changes, so it cannot show that a quiet host is alive, and `quickHostCheck` is too slow for each 15 seconds.
- `degraded` means one or two failed heartbeats in a row, or a latency above 5 seconds. `disconnected` means three failed heartbeats in a row. A `degraded` host gets no new work. Reason: the Spec names the states but does not define them; this gives a short tolerance for one lost heartbeat and keeps new work off a host that is not reliable.
- The state `not-ready` of `workerHosts()` stays. `wrong-version` becomes `version-mismatch`. Reason: ROW-116 uses `not-ready` for a host whose short check fails, and the Spec uses the name `version-mismatch`.
- The command queue is a durable file. Reason: a `factory stop` with a disconnected host must not lose its `stop-thread`, and ROW-117 sends the queue at the next start.
- `factory stop` waits for a connected host with a time limit of 60 seconds. Reason: the Spec says that the stop waits for each connected host, but a stop must not wait without an end.
- A `stop_worker` of the supervisor while the host is disconnected queues `stop-thread` and the run keeps its wait until the reconnect. A cancel while the host is disconnected queues `cancel-thread` and ends the wait, as today. Reason: a stop is not an abandon, and the cancel case belongs to ROW-99.
- A cut before the `launch` command has a request id fails the launch with the error of the host, not with `NETWORK`. Reason: no work runs on the host yet, so no result can be lost, and a `NETWORK` failure would pause the provider of the model. The supervisor can start a new worker for the Story.
- (Development) The host gives its receipt when the `submit` request succeeds: the host wrote the command durably. A queued command leaves the queue then. A submit that the host refuses (exit code other than 0) also leaves the queue, and a refused queued launch fails its run. Reason: the queue must not keep a command that the host will never accept.
- (Development) A stop or a cancel of a Thread whose `launch` or `resume` is still in the queue removes that launch from the queue and ends the wait of the run. Reason: the host processes its command files in id order, not in the order of arrival, so a queued stop cannot be sure to come after a queued launch. The queued stop still stops a run that the host started.

## Review findings

- Merge conflict with `origin/main` (Changelog Stage): `docs/architecture/native-factory/host-agent.md` has a conflict when `origin/main` is merged into `story/ROW-97`. Merge `origin/main`, repair the conflict in this file, run the checks and push. The Changelog Stage did not add the changelog entry because of this conflict.
