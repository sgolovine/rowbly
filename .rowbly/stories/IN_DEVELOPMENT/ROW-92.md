---
title: Run remote workers in the host agent
stage: IN_DEVELOPMENT
position: 11
dependsOn:
  - ROW-82
  - ROW-88
  - ROW-89
  - ROW-90
  - ROW-91
createdAt: 2026-11-16T19:45:07.547Z
updatedAt: 2026-11-16T22:33:59.263Z
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-92
pull_request: https://github.com/sgolovine/rowbly/pull/285
---

## Goal

The host agent (`rowbly host serve`, ROW-89) runs remote workers. The main machine prepares a run with a copy of the tracked `.rowbly/` files, then sends a `launch` command. The host agent makes the worktree from the managed clone (ROW-88), runs the Pi session through the executor of ROW-82, and writes the state of the run to durable files. `rowbly host attach` sends the state on the channel. A worker continues when the channel stops. Its result waits on the host until the next connection.

Read the Spec `remote-worker-hosts`, sections "The copy and inbound updates" and "Disconnects".

## Scope

In scope:

- **The copy builder on the main machine.** A service function that reads the tracked `.rowbly/` files of a Project (Stories, Stages, config, prompts, Specs and the attachment manifests) without `state.json`, `runtime/` and the PNG files. It also gives the list of the PNG attachments of the Story and of its upstream Stories. ROW-96 calls it.
- **The PNG cache on the host.** Two hidden commands: `rowbly host cache-missing <project-id>` (a request call: it gets a list of attachment ids and gives the ids that are not in the cache) and `rowbly host cache-put <project-id> <attachment-id>` (an upload call: the PNG bytes on stdin). They use the cache service of ROW-91.
- **The prepare step.** A hidden command `rowbly host prepare <project-id>` (a request call). The input on stdin has the Thread id, the Thread record, the Story id, the clone path (from the host record of ROW-88), the worker model, the worker message and the copy (the files and the PNG attachments to take from the cache). It writes the copy into the folder of the Thread and records the launch data. It refuses while the Thread has active work.
- **The run commands.** The command types `launch`, `resume`, `stop-thread` and `cancel-thread` in `host-agent-control.ts`, each with a `threadId`. The existing `launch` (ROW-89) gets its data from the prepare step. `stop` stays the stop of the full agent.
- **The runner.** The real `HostWorkRunner` of ROW-89. For each `launch` or `resume`:
  1. Read the prepared launch data and the Story from the copy.
  2. `git fetch origin` in the clone, then a fast-forward of the current branch of the clone to its upstream.
  3. `prepareWorkerWorktree` with the clone as root, through the local executor. The worktree is `<clone>-worktrees/<story-id>` (`remoteWorktreesDir` of ROW-88). Existing work is never reset.
  4. The Pi session, the result tool and the activity, through `createLocalExecutor` of ROW-82. The session files go below the runtime folder of the host agent, not below the clone.
  5. The worker shell has `ROWBLY_OUTBOX` (the outbox folder of the agent) and `ROWBLY_THREAD_ID`. Thus each CLI write of the worker goes to the copy and to the outbox (ROW-90, ROW-91).
- **The run state.** The runner writes the events of the executor to `threads/<thread-id>/run.json`: the phase, the worktree, the session (model and file), the last activity and usage, the reported result, the final usage, the failure and the end reason (`completed`, `failed`, `stopped` or `cancelled`).
- **The channel.** `rowbly host attach` sends a `run` frame with the content of `run.json` for each Thread when the channel opens, and again when `run.json` changes.
- **Disconnects.** The workers continue when the channel stops. `run.json` keeps the result until the next connection, also after the agent stops when idle.
- Documentation in STE: `docs/architecture/native-factory/host-agent.md` (the prepare step, the run commands, the Thread folder, the run state and the `run` frame) and the new hidden commands in `docs/architecture/cli.md`.

Not in scope:

- Checks on the host and the `run_check` tool of a remote worker (ROW-93). A remote worker has no `run_check` tool and no check gate in this Story.
- The dispatch from the main machine: the `RemoteExecutor`, the build of the worker message with the host paths, the base of the copy, and the apply of the outbox (ROW-96).
- The reconnect, the command queue of the main machine and the read of the runs after a restart (ROW-97).
- Inbound updates to a running copy (ROW-98).
- The fetch of a PNG that is not in the copy from the main machine, and the offline error of that read: ROW-110.
- The session lines on the channel: ROW-111.
- The removal of old Thread folders, `run.json` files and copies.

## Acceptance criteria

- [ ] Copy builder: a test with `useTestProject` examines that the copy has the Story, Stage, config, prompt, Spec and attachment manifest files, and has no `state.json`, no file of `runtime/` and no PNG file. The PNG list has the attachments of the Story and of its upstream Stories only.
- [ ] Cache commands: a test examines that `cache-missing` gives only the ids that are not in the cache, and that `cache-put` puts a PNG that `cache-missing` then does not give. A bad attachment id, bytes that are not a PNG and bytes larger than 10 MiB give `VALIDATION`.
- [ ] Prepare: a test examines that `prepare` writes the copy to `threads/<thread-id>/copy/.rowbly/`, with each listed PNG from the cache, and that each folder has mode 0700 and each file mode 0600. A path that is not below `.rowbly/`, that has `..`, or that is `state.json` or below `runtime/` gives `VALIDATION`. A PNG that is not in the cache gives `VALIDATION` with the missing ids. A `prepare` while the Thread has active work gives `CONFLICT`. Each failure writes no copy.
- [ ] Launch: a test with the faux provider and a temporary Git repository as the managed clone runs a `launch`. The worktree is `<clone>-worktrees/<story-id>`, the worker reports a result, and `run.json` has the worktree, the session, the result, the final usage and the end reason `completed`. The slot is released.
- [ ] A `launch` or `resume` without a prepared Thread is rejected, and no slot stays.
- [ ] Fetch: a test examines that the runner fetches `origin` in the clone and fast-forwards the clone before it makes the worktree. A new commit on `origin` is in the new worktree. A clone that cannot fast-forward fails the run with a clear error in `run.json`, and the worktrees are not changed.
- [ ] Existing work: a test with a worktree that has an uncommitted file runs a `launch`. The file stays.
- [ ] Canonical files: a test runs a CLI write (`story update`) in the worker shell environment of a run. The copy has the change, the outbox has one entry with the Thread id, and `git -C <clone> status --porcelain` is empty. No file below `<clone>/.rowbly/` changes and no session file is below the clone.
- [ ] Stop and cancel: a test runs `stop-thread` and `cancel-thread` on a running faux worker. The session aborts, `run.json` has the end reason `stopped` or `cancelled`, and the slot is released. A stop or cancel of a Thread without work completes with no effect.
- [ ] Resume: a test runs a `resume` after a `stop-thread`. It uses the same session file and the same worktree. A `resume` without the session file or the worktree on the host is rejected with `NOT_FOUND`.
- [ ] Channel: a test reads `rowbly host attach` frames. It gets a `run` frame for each Thread when the channel opens, and a new `run` frame when the result arrives.
- [ ] Disconnect: a test with the fake transport and the faux provider opens the channel, starts a run, closes the channel during the run, and lets the run complete. The run completes with no change. A new channel then gives a `run` frame with the result.
- [ ] The modules of `src/services/host-agent/` still import while Pi is mocked to throw (`src/services/pi-runtime/import-boundary.test.ts`). Only the start of a run loads Pi.
- [ ] `rowbly host --help` does not show the new hidden commands. `src/commands/register-commands/register-commands.test.ts` lists them as hidden actions.
- [ ] No test uses real SSH or live credentials. Tests use temporary folders for the home folder.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- **Base branch.** The worktree of this Story was made before the merge of ROW-89 (PR #280). It is on a detached `HEAD`. Make the branch `story/ROW-92`, then merge `origin/main` first, so that `src/services/host-agent/` exists.
- **Host paths.** Extend `hostAgentPaths` in `src/services/host-agent/host-agent-paths.ts` with:
  - `threads`: `<agent>/threads/`. Each Thread has `threads/<thread-id>/` with `copy/` (the copy root, with `.rowbly/` in it), `launch.json` (the prepared launch data), `run.json` (the run state) and `write.lock` (the lock of the worker command prefix).
  - `runtime`: `<agent>/runtime/`. The local executor uses it as `runtimeDir`, so the session files are `runtime/sessions/<thread-id>/…`, with the same relative shape as on the main machine.
  - `attachments`: `<agent>/attachments/`, the PNG cache folder.
  - `bin`: `<agent>/bin/rowbly`, the CLI shim of the worker.
  Export a pure function, for example `hostRunPaths({ home, projectId, clone, threadId, storyId })`, that gives the copy, the worktree, the lock and the shim. ROW-96 uses it to build the Run section of the worker message.
- **Copy builder.** Put it in a new service folder, for example `src/services/thread-copy/` (`thread-copy.ts` and its test). Use `projectPaths` and the Story services. Read the upstream Stories from `dependsOn`. Use `git ls-files` only if it is necessary; a folder walk that skips `state.json*`, `runtime/` and `*.png` is sufficient.
- **Prepare.** Put the logic in `src/services/host-agent/host-agent-prepare.ts`. Validate each copy path against `.rowbly/`, refuse `..`, absolute paths, `state.json*` and `runtime/`. Write the copy into a temporary folder in `threads/<thread-id>/`, then rename it over `copy/`. Write `launch.json` with `writeFileAtomic(..., { durable: true })`. Take the PNG files with `readCachedAttachment` of `src/services/attachment-cache/attachment-cache.ts` and write them to `.rowbly/attachments/<story-id>/<id>.png`. Limit the input of `prepare`, for example to 32 MiB.
- **Commands.** Add `resume`, `stop-thread` and `cancel-thread` to `COMMAND_TYPES` in `host-agent-control.ts`. Each needs a valid `threadId`. Keep the duplicate rules of ROW-89: a command that arrives two times has one effect. Keep `HOST_COMMAND_LIMIT` (64 KiB): the copy and the message go through `prepare`, not through the command.
- **Runner.** Put it in `src/services/host-agent/host-runner.ts`. It implements `HostWorkRunner` and imports the Pi code lazily (`await import(...)` of the module that calls `createLocalExecutor` and `createFactoryRuntime`), so that `host-agent.ts` does not load Pi. Give the runtime and the agent folder as optional dependencies, so that tests give a faux runtime. The `host serve` command (`src/commands/host/host.ts`) makes the real runner and the CLI shim, and passes them to `runHostAgent`. Write the shim with the same script as `createCliShim` in `src/commands/factory-runner/cli-shim.ts`; let that module write to a given path, or export the script function. Do not copy the script.
- **Local executor changes** (`src/services/factory-manager/local-executor.ts`). Keep the behaviour of the local factory. Make these inputs optional or separate:
  - the Git root of the worktrees (the clone) separate from `runtimeDir` (the host runtime folder);
  - the root that goes to `ROWBLY_ROOT` (the copy);
  - extra worker shell variables (`ROWBLY_OUTBOX`, `ROWBLY_THREAD_ID`): add an optional `env` to `WorkerShell` in `src/services/factory-worker/worker-env.ts` and to the `worker` option of `openFactorySession`;
  - the check queue: without a queue, the executor gives no check tools and no check gate (ROW-93 adds them).
- **Events to `run.json`.** The runner gives `WorkerEvents` to `launch` of the local executor. `worktreeReady`, `sessionOpened`, `resultReported`, `completed`, `failed` and `finished` write `run.json` with `durable: true`. `activity` writes without `durable` (at most one time each second, as the executor already does). `message` gives the prepared message. `stopping` is true after a `stop-thread`, a `cancel-thread` or a stop of the agent. The end reason is `stopped` or `cancelled` after the matching command, `failed` after `failed`, otherwise `completed`. The failure has the code and the message of the error, and `sessionOpened`.
- **Worktree.** Give the local executor a Story whose `fields.worktree` is `<clone>-worktrees/<story-id>`, because the value in the copy is a path of the main machine. For a resume, the executor keeps `thread.worktree` (the path that `run.json` reported).
- **Fetch.** Run `git -C <clone> fetch origin`, then `git -C <clone> merge --ff-only @{upstream}` with `execFile` (never `shell: true`), and `GIT_TERMINAL_PROMPT=0`. Do this before `prepareWorkerWorktree`. A failure fails the run (`failed` in `run.json`).
- **Attach.** Add the `run` frame to `src/services/host-agent/host-attach.ts` with the same change detection as the receipt frames.
- **Stop and cancel.** `stop-thread` calls `stop`, and `cancel-thread` calls `cancel`, of the local executor for that Thread. The executor aborts the session. The work then ends and the agent releases the slot (ROW-89).
- **Safety.** The host agent does not take the Project write lock or the state lock, and it never reads or writes `<clone>/.rowbly/`. The worker CLI gets `-C <copy>` from the message. A copy is not a Git repository, so `lockPath` in `src/services/project-write/project-commit.ts` uses its fallback; the message uses `threads/<thread-id>/write.lock` as the `flock` file.
- Follow the `rowbly-code-style` skill: dash-case files, `.js` import extensions, a `Store` for the short-lived run state, one concern for each file, a test next to each new service file. The services do not print, prompt, exit or read `process.env`.

## Assumptions

- The launch has two steps: `host prepare` (a request call with the copy, the Thread record, the model and the message), then the durable `launch` command with only the `threadId`. Reason: a command file has a limit of 64 KiB (ROW-89), and the copy is larger. A request call has no such limit, and the command keeps the duplicate rules.
- The main machine builds the worker message and sends it in `prepare`. The host does not change it. Reason: `workerMessage()` stays the only place that builds the message, and ROW-96 builds it with the host paths. This Story gives the pure path function that ROW-96 needs.
- A `prepare` for a Thread without active work replaces the old copy. A resume gets a new copy. Reason: the Spec sends a copy with each launch, and the outbox already holds the writes of the earlier run.
- `resume` is a separate command type that requires the session file and the worktree on the host. Reason: the Story names resume commands, and a resume on a host without the session must fail clearly, because a remote Thread resumes only on its own host.
- The per-Thread stop and cancel are new command types (`stop-thread`, `cancel-thread`). `stop` stays the stop of the full agent. Reason: ROW-89 defined `stop` for the agent, and ROW-97 uses it for `factory stop`.
- The host reports facts (the end reason, the result, the failure), not a Thread status. Reason: only the manager changes the Thread (ROW-82), and ROW-96 maps the facts to the Thread status.
- The run state is one file for each Thread (`run.json`), not an event log. The channel sends the full state. Reason: a state file keeps the last values through a disconnect and an idle stop of the agent, and the main machine gets each value again after a reconnect. ROW-97 makes sure that each result is applied one time.
- "The host agent starts no new work while the channel stops" means that the host never starts work without a `launch` or `resume` command. A command does not need an open channel. Reason: commands come through separate request calls (ROW-89), so a host without a connection gets no new commands.
- The clone is fetched and then fast-forwarded to its upstream. A clone that cannot fast-forward fails the run. Reason: `prepareWorkerWorktree` starts a new branch from `HEAD`, and a fetch alone does not move `HEAD`. A failure is better than work on an old base. Rowbly never resets the clone.
- The PNG cache is in the runtime folder of each Project on the host. Reason: attachment ids are unique, but a cache for each Project keeps the files of a Project together and private.
- The fetch of a missing PNG and the session lines on the channel are separate Stories (ROW-110, ROW-111). Reason: one pull request cannot hold all the work. ROW-110 also needs the channel handler of the main machine (ROW-96).
- A remote worker in this Story has no `run_check` tool. Reason: checks on the host are ROW-93. Without a check queue, the worker message must not have the checks block (ROW-96).
- The cache commands accept an attachment file of any type, not only a PNG. Bytes that are not a PNG no longer give `VALIDATION`; only a bad id and bytes larger than 10 MiB do. The copy builder lists each attachment file with its name (`attachmentFileName`), and `prepare` writes it with that name. Reason: the base branch (`6ddebfef`) supports attachments of any file type, so the "not a PNG" part of the cache acceptance criterion no longer applies.
