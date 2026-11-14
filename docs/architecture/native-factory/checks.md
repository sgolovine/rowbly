# Factory checks

The native factory runs the deterministic checks of its workers, for example `pnpm test`. A worker
asks for a check with the `run_check` tool. The factory puts the request in one queue. The queue
starts the check when a slot and memory are available. Then the worker gets the result.

Read this page when you change the `checks` settings, the `check-queue/` service, the `run_check`
tool, the bash gate or the check records.

## Scope

- Only the workers of the native factory (`rowbly factory run`) use the queue. The CLI, the board
  and the agent sessions outside the factory do not change.
- The supervisor does not run checks and does not decide about them. The queue has no model work.
- The memory rules use `/proc`. The native factory runs only on Linux.
- Without a `checks` key in the factory settings, or without items, the factory works as before. The
  workers get no `run_check` tool, and the bash gate rejects nothing.

## Settings

The `checks` key of the `factory` section of `.rowbly/rowbly.config.json` holds the limits and the
named checks. `factory-settings/check-settings.ts` reads and validates it.

```json
{
  "factory": {
    "checks": {
      "maxConcurrent": 4,
      "reserveMemoryMb": 2048,
      "items": [
        {
          "key": "test",
          "label": "Tests",
          "command": "pnpm test",
          "narrowCommand": "pnpm vitest related --run {files}",
          "memoryMb": 1500,
          "timeoutMinutes": 20,
          "block": ["pnpm test", "vitest"]
        }
      ]
    }
  }
}
```

| Key                      | Default | Meaning                                                                   |
| ------------------------ | ------- | ------------------------------------------------------------------------- |
| `maxConcurrent`          | `2`     | The maximum number of checks that run at the same time. Range 1 to 32.    |
| `reserveMemoryMb`        | `2048`  | The memory that the queue always keeps free.                              |
| `items[].key`            | none    | The name that a worker gives to `run_check`. Lowercase, digits, `_`, `-`. |
| `items[].label`          | the key | The name that the TUI shows.                                              |
| `items[].command`        | none    | The full check. It runs through the shell in the worktree.                |
| `items[].narrowCommand`  | none    | Optional. It must contain `{files}`.                                      |
| `items[].memoryMb`       | `1024`  | The first memory estimate of the check.                                   |
| `items[].timeoutMinutes` | `30`    | The queue stops the check after this time. Range 1 to 240.                |
| `items[].block`          | `[]`    | Text that the bash gate rejects, in addition to `command`.                |

- A `checks` section that is not valid gives a `ValidationError` from `getFactorySettings`. Then
  `rowbly factory start` and `rowbly factory configure` fail, and the config does not change.
- `getFactorySettings` gives the default of each absent key. A write does not add the defaults to
  the config. A write keeps the other keys of the `factory` section and of the config.
- `factory-settings/check-items.ts` adds, changes, removes and lists the items. `setCheckLimits`
  sets the limits. These functions do not load Pi.
- The supervisor loop reads the factory settings again on each turn. A changed setting applies to the next
  admission. A restart is not necessary.

## The `run_check` tool

`createCheckTool` in `factory-worker/check-tool.ts` makes the tool. `openWorkerSession` in
`factory-manager/worker-launch.ts` gives it to each worker through `workerChecks`
(`factory-manager/worker-checks.ts`). `WORKER_TOOLS` in `pi-runtime/factory-session.ts` has its name.
The session turns the tool on only when the factory gives it.

| Field   | Type              | Meaning                                                          |
| ------- | ----------------- | ---------------------------------------------------------------- |
| `check` | string            | The key of a configured check.                                   |
| `files` | string[], max 200 | Optional. The changed files. Then the tool runs `narrowCommand`. |

1. An unknown `check` gives an error that lists the configured keys.
2. If the check has no `narrowCommand`, or `files` is empty, the tool runs the full `command`.
3. Each file must be a relative path inside the worktree. Otherwise the tool gives an error.
4. In `narrowCommand`, `{files}` becomes the shell-quoted list of the files.
5. The tool waits until the check stops. It has no time limit of its own.
6. While the check waits or runs, the tool sends progress through `onUpdate`, for example
   `queued, position 2` or `running, 1m40s`.
7. If the Pi signal aborts the tool, the queue removes the job or stops its process group.

The result has `status` (`passed`, `failed`, `timed_out`, `cancelled` or `error`), `exitCode`,
`durationSeconds`, `scope` (`full` or `narrow`), the Git `head` of the worktree, the `log` path and
the last 200 lines of output. The output has a maximum of 20000 characters.

## The queue

The `check-queue/` service holds the queue in the factory daemon. `openCheckQueue` in
`worker-checks.ts` makes one queue for each manager. Tests inject the memory reader, the process
reader, the spawn function, the signals and the clock (`CheckQueueDeps`). Thus no test starts a
real check.

| File               | What it does                                                         |
| ------------------ | -------------------------------------------------------------------- |
| `check-queue.ts`   | Submit, admission, cancel, stop and the `status.json` part.          |
| `check-process.ts` | Start, memory samples, timeout, SIGTERM then SIGKILL, and the end.   |
| `check-order.ts`   | Pure rules: order, estimate, admission, output tail and progress.    |
| `check-records.ts` | `jobs.json`, the logs and the limit of 500 jobs.                     |
| `check-orphans.ts` | The stop of the check processes of a dead owner.                     |
| `proc-readers.ts`  | The real `/proc` readers, `bash -c` spawn, group signals and `HEAD`. |

### Order and admission

1. The jobs of the Story nearest to the last Stage go first. This is the same order as the worker
   limit in `factory-policy/`.
2. Jobs of the same Stage go in the order of arrival.

The queue starts the next job only if these two conditions are true:

1. Fewer than `maxConcurrent` jobs run.
2. `MemAvailable` from `/proc/meminfo`, minus `reserveMemoryMb`, is equal to or more than the
   estimate of the job.

If no job runs, the next job starts also when condition 2 is false. Thus a large check cannot wait
without an end. The queue does the admission again when a job stops, when a job arrives, and each 5
seconds while jobs wait.

The estimate of a job is the larger of `memoryMb` and the largest peak of the last 10 runs of the
same check key and scope.

### Process and memory

- A job runs through `bash -c` in the worktree of the worker. It uses the environment of the worker
  `bash` tool (`workerShellEnv`), with `ROWBLY_CHECK=1` in addition.
- Each job runs in its own process group (`detached: true`).
- Each second, the queue adds the RSS of all processes in the group, from `/proc/<pid>/status`. It
  records the peak.
- A timeout or a cancel sends SIGTERM to the group, then SIGKILL after 5 seconds.
- When the leader of the group stops, the group gets SIGKILL. Thus no child of a check stays alive.

## The bash gate

The worker `bash` tool (`workerBash` in `pi-runtime/factory-session.ts`) rejects a command before it
runs if the command contains the `command` text or a `block` text of a configured check.

- The rejection is a tool error: `Run this check with run_check: <key>`.
- The gate does not apply to the processes that the queue starts.
- The gate compares text. A worker that runs a check through a script file is not stopped. The rule
  in the worker system prompt covers this case.

## Prompts and the digest

- `src/config/prompts/WORKER.md` has the check rules between `<!-- checks -->` and
  `<!-- /checks -->`. `workerMessage` keeps this text only when the Project has checks.
- The rules tell the worker to run each check only through `run_check`. They also tell the worker
  to run each full check one time before `report_result`, after the last change.
- The worker system prompt has priority over the Stage prompt and the user prompts.
- `runSection` in `src/services/messages/messages.ts` lists the checks: key, label and the narrow form.
- `buildDigest` in `factory-manager/supervisor-loop.ts` adds `checks` to each worker that has
  checks: the last full result, the last narrow result and the commit of each check key.
- The factory does not refuse a result without a full check. It records and shows the history.

## Records

```
.rowbly/runtime/checks/
  jobs.json     # the last 500 jobs
  <job id>.log  # the full output of one job, mode 0600
```

- Each job in `jobs.json` has its id, owner token, Thread, Story, Stage, check key, scope, files,
  status, times, exit code, `HEAD`, memory estimate, peak memory, process group and Linux start ticks.
- The Thread metadata (`runtime/threads/<id>.json`) gets a short `checks` list: job id, check key,
  scope, status, `HEAD` and duration. The list keeps the last 20 checks.
- `runtime-files/` creates `runtime/checks/` with mode 0700. The `/runtime/` ignore rule keeps it
  out of Git.

## Status, stop and recovery

- `status.json` gets `checks` when the factory settings have a `checks` key: `running`, `queued`,
  `availableMb`, `maxConcurrent` and the jobs that run or wait.
- A normal stop cancels the queued jobs and stops each running process group. Then the daemon
  releases the ownership.
- A cancel of a worker cancels its queued and running jobs. The end of a worker session also
  cancels them.
- After the death of an owner, `factory-recovery/` calls `stopOrphanChecks`. It reads `jobs.json`.
  It stops each process group whose leader still has the recorded start ticks. It marks the jobs of
  the dead owner `cancelled`.

## Related

- [controls.md](controls.md): `factory check`, the check flags of `factory configure` and the
  Checks tab.
- [pi-runtime-and-auth.md](pi-runtime-and-auth.md#factory-settings): the other factory settings.
- [runtime-and-locks.md](runtime-and-locks.md): the runtime files and the locks.
- [recovery.md](recovery.md): stop, cancel and recovery.
