---
title: Run checks of remote workers on their host
stage: IN_DEVELOPMENT
position: 12
dependsOn:
  - ROW-92
createdAt: 2026-11-16T19:45:08.084Z
updatedAt: 2026-11-16T22:45:47.934Z
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-93
pull_request: null
---

## Goal

The `run_check` tool works for remote workers. Each check runs on the worker host of the worker, in a check queue of the host agent. The main machine gets the check records of each remote Thread, so the Thread has its `checks` list as for a local worker.

Read the Spec `remote-worker-hosts`, section "Checks", and `docs/architecture/native-factory/checks.md`. ROW-92 (done) added the runner of the host agent (`src/services/host-agent/host-runner.ts`). In ROW-92, a remote worker has no `run_check` tool and no check gate. This Story adds them.

## Scope

In scope:

- **The check queue of the host agent.** One queue for each host agent (one Project on one host). The host agent opens it after it takes its claim, with the owner token of the agent. The check records and the logs go to `<agent>/runtime/checks/` (`jobs.json` and `<job id>.log`), not below the clone and not below the copy.
- **The settings from the copy.** Each remote run reads the factory settings from its copy (`getFactorySettings({ cwd: <copy> })`) when the run starts. The check items of the run come from these settings. The limits of the queue (`maxConcurrent`, `reserveMemoryMb`) come from the settings of the run that started last.
- **The `run_check` tool and the bash gate.** The runner gives the queue and the settings to the local executor of each run (`openRunExecutor`). Then the remote worker gets `run_check`, and its `bash` tool rejects the commands of the checks, as for a local worker. A copy without checks gives no tool and no gate, as for a local worker.
- **The check environment.** A check of a remote worker runs in the worktree of the worker on the host, with the environment of the worker `bash` tool: also `ROWBLY_OUTBOX` and `ROWBLY_THREAD_ID`, and `ROWBLY_CHECK=1`.
- **The check records to the main machine.** `run.json` of the Thread gets a `checks` list with the same shape as `ThreadCheck` (job id, key, scope, status, `HEAD`, duration), with a maximum of 20 entries. Each job change writes `run.json`. Thus the `run` frame of `rowbly host attach` sends the list when it changes, and again after a reconnect.
- **Stop and cancel.** `stop-thread`, `cancel-thread`, a stop of the agent and the end of a worker session cancel the queued and running checks of the worker (SIGTERM to the process group, then SIGKILL after 5 seconds). When the agent stops, it stops the queue (`stopCheckQueue`) before it releases its claim.
- **Recovery.** When the host agent takes its claim, it calls `stopOrphanChecks` for its runtime folder before it opens the queue. Thus the check process groups of a dead agent stop, only while their leader has the recorded `/proc` start ticks, and their jobs become `cancelled`.
- **Disconnects.** A check continues when the channel stops. Its record waits in `run.json` until the next connection.
- Documentation in STE: the remote checks in `docs/architecture/native-factory/checks.md` and in `docs/architecture/native-factory/host-agent.md` (the queue, the `checks` list of `run.json`, stop and recovery).

Not in scope:

- A shared check queue for the main machine and the hosts, or for all Projects of one host.
- The map of the `checks` list of `run.json` to the Thread record on the main machine, and the checks block in the worker message with the host paths. ROW-96 does this, because it adds the dispatch and the handler of the `run` frame.
- The check queue of a host in `status.json`, `rowbly factory status` or the TUI.
- Real SSH. Tests use the fake transport.

## Acceptance criteria

- [ ] Check on a remote worker: a host runner test with the faux provider, a copy whose config has one check, and fake `CheckQueueDeps` runs a `launch`. The faux worker calls `run_check`. The worker gets the result. `<agent>/runtime/checks/jobs.json` has the job with the owner token of the agent, the Thread id and the worktree of the run as `cwd`. `run.json` has a `checks` entry with the status `passed`.
- [ ] Settings from the copy: a run whose copy has no checks gives the worker no `run_check` tool. The faux worker `bash` call of a configured check command gets the error `Run this check with run_check: <key>`.
- [ ] Environment: the fake spawn of a check gets `ROWBLY_OUTBOX`, `ROWBLY_THREAD_ID`, `ROWBLY_ROOT` (the copy) and `ROWBLY_CHECK=1`.
- [ ] Cancel: a test runs `cancel-thread` while a check of the Thread runs. The fake process group gets SIGTERM, the job is `cancelled` in `jobs.json` and in the `checks` list of `run.json`, and `run.json` has the end reason `cancelled`. A `stop-thread` gives the same check result.
- [ ] Disconnect: a test with the fake transport opens `rowbly host attach`, starts a run, closes the channel while a check runs, and lets the check and the run complete. A new channel gives a `run` frame whose `checks` list has the final check status.
- [ ] Recovery: a test writes a `jobs.json` with a running job of a different owner token. When the host agent starts, the fake `kill` gets SIGTERM for the group only when the fake `readStartTicks` gives the recorded start ticks. The job becomes `cancelled`.
- [ ] Agent stop: when the agent stops, the queued jobs are `cancelled` and each running group gets a signal.
- [ ] The modules of `src/services/host-agent/` still import while Pi is mocked to throw (`src/services/pi-runtime/import-boundary.test.ts`).
- [ ] No test starts a real check, uses real SSH or uses live credentials.
- [ ] The local factory checks do not change: the existing tests of `check-queue/`, `worker-checks` and the factory manager pass.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- **Base branch.** The worktree of this Story is on a detached `HEAD` that does not have ROW-92 (PR #285). Make the branch `story/ROW-93`, then merge `origin/main` first, so that `host-runner.ts`, `host-run-executor.ts`, `host-run-events.ts` and `host-run-state.ts` exist.
- **Host Project paths.** `createCheckQueue`, `check-records.ts` and `stopOrphanChecks` take `ProjectPaths` and use `runtimePath`, which reads `paths.dir` and `paths.runtimeDir`. Give the host agent a small adapter, for example `{ dir: <agent dir>, runtimeDir: <agent>/runtime, … }`, from `hostAgentPaths`. `runtime/checks/` must have mode 0700, as on the main machine.
- **Queue module.** Add `src/services/host-agent/host-checks.ts` (and its test). It opens the queue with `createCheckQueue({ paths, ownerToken, deps, limits, onChange })`. `limits` reads a `Store` that each run updates with the settings of its copy. `onChange` sends each job to the run of its Thread (a map of Thread id to run), which writes the `checks` list of `run.json`. Do not import `factory-manager/worker-checks.ts`'s `openCheckQueue`, because it needs a `Manager`. Move the pure helpers `threadCheck` and `withCheck` (and the limit of 20) of `worker-checks.ts` to a shared module, for example `check-queue/thread-checks.ts`, and use them in both places.
- **Agent wiring.** `runHostAgent` (`host-agent.ts`) takes the claim, calls `stopOrphanChecks`, opens the queue, gives it to the runner, and calls `stopCheckQueue` before it releases the claim. Add an optional `checkDeps` to `HostAgentOptions` for tests (default `realCheckDeps()`). Give the queue to the runner without a change to the command flow, for example a field of `HostLaunchRequest` or a `bind` step of `HostWorkRunner`. The modules must not load Pi.
- **Runner.** In `host-runner.ts`, read `getFactorySettings({ cwd: copy })` before `openRunExecutor`. A settings read that fails fails the run, with the error in `run.json`. Give `checks` (the queue) and `settings: () => settings` to `createLocalExecutor` in `host-run-executor.ts`. The local executor already gives the tool, the gate (`blockedCheck` in `factory-worker/worker-env.ts`) and the cancel of the checks at the end of the session (`cancelThreadChecks` in `finishWorker`).
- **Check environment.** `runCheck` in `factory-manager/worker-checks.ts` calls `workerShellEnv({ root, shim }, process.env)` without the extra `env`. Add an optional `env` to `CheckToolInput` and pass `input.env` from `executorChecks` in `local-executor.ts`. The local factory gives no `env`, so its behaviour does not change.
- **Run state.** Add the optional `checks: readonly ThreadCheck[]` to `HostRunState` in `host-run-state.ts`. Write it with `durable: true` when a job reaches a final status, and without `durable` for `queued` and `running`. Use the write chain of `host-run-events.ts` (`changeRun`) so that the last state wins. A job change after the end of the run still updates `run.json`.
- **Stop and cancel.** `requestStop` aborts the session through the executor. `finishWorker` of the local executor then calls `cancelThreadChecks`. A run that stops before its session opens has no checks, because the worker has no tool yet.
- **Rank.** `runCheck` calls `listStages(ctx)` with the copy as `cwd`. Thus the order of the jobs uses the Stages of the copy.
- Follow the `rowbly-code-style` skill: dash-case files, `.js` import extensions, a `Store` for short-lived state, a test next to each new service file. Services do not print, prompt, exit or read `process.env` (except the existing `runCheck` environment).

## Assumptions

- One check queue for each host agent, so one queue for each Project on a host, not one for each machine. Reason: the Spec says "the check queue of the host agent", and a shared queue is out of scope. The host worker limit already limits the workers of all Projects.
- The limits of the queue come from the settings of the run that started last. Reason: each Thread has its own copy, and the copies of one Project normally have the same config. The newest copy has the newest config, as the main machine reads the config again on each turn.
- The check records go to the main machine in the `checks` list of `run.json` and the existing `run` frame, not in a new frame type. Reason: `run.json` keeps the values through a disconnect, and the channel already sends it again after a reconnect. The smallest change agrees with the design of ROW-92.
- ROW-96 maps the `checks` list to the Thread record and keeps the checks block in the message of a remote worker. Reason: ROW-96 owns the handler of the `run` frame and the build of the remote worker message, and it is not done yet.
- A check gets the outbox variables of the worker shell. Reason: the docs say that a check uses the environment of the worker `bash` tool. Without them, a CLI write in a check goes to the copy only and never to the main machine.
- The check queue of a host is not in `status.json` in this Story. Reason: the Story does not ask for it, and the host status in the TUI is a separate Story of the Spec.
