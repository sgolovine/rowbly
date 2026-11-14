---
title: Factory check queue
stories:
  - ROW-22
---

# Factory check queue

## Problem

The worker system prompt (`src/config/prompts/WORKER.md`) tells each worker to read the repository
instructions. The Stage prompts can also tell a worker to run checks. Thus each worker runs the
checks of the repository in its own worktree through its `bash` tool, for example `pnpm test`.

When 3 or 4 workers run a check at the same time, the machine can run out of memory. The factory
does not record these checks, so the user cannot see them.

## Goal

The factory runs all deterministic checks of its workers. A worker asks the factory for a check. The
factory puts the request in a queue and runs it when a slot and memory are available. Then the
factory gives the result to the worker.

## Scope

- This feature applies only to the workers of the native factory (`rowbly factory run`). The factory
  manager (`src/services/factory-manager/`) owns the queue.
- It does not change the CLI, the board or agent sessions outside the factory. A user can still run
  any command outside the factory.
- The supervisor does not run checks and does not decide about them. The queue has no model work.
- The native factory runs only on Linux. Thus the memory rules use `/proc`.

## Settings

The settings are in a new `checks` section of `.rowbly/factory.json`. `factory-settings/` reads and
validates them, in the same way as `maxWorkers` and `git`.

```json
{
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
```

| Key                      | Default | Meaning                                                                  |
| ------------------------ | ------- | ------------------------------------------------------------------------ |
| `maxConcurrent`          | `2`     | The maximum number of checks that run at the same time. Range 1 to 32.   |
| `reserveMemoryMb`        | `2048`  | The memory that the queue always keeps free.                             |
| `items[].key`            | none    | The name that a worker gives to `run_check`. It uses the rules of a key. |
| `items[].label`          | the key | The name that the TUI shows.                                             |
| `items[].command`        | none    | The full check. It runs through the shell in the worktree.               |
| `items[].narrowCommand`  | none    | Optional. `{files}` becomes the shell-quoted list of files.              |
| `items[].memoryMb`       | `1024`  | The first memory estimate of the check.                                  |
| `items[].timeoutMinutes` | `30`    | The queue stops the check after this time. Range 1 to 240.               |
| `items[].block`          | `[]`    | Text that the bash gate rejects, in addition to `command`.               |

- Without a `checks` section, the factory has no checks. The bash gate rejects nothing, `run_check`
  is not given to workers, and workers run checks as before.
- A `checks` section that is not valid gives a `ValidationError` from `getFactorySettings`. Then
  `rowbly factory start` and `rowbly factory configure` fail, and `factory.json` does not change.
- `getFactorySettings` gives the default of each key that is not in the file. A write does not add
  the defaults to the file. An update keeps the other keys of `factory.json`.
- `rowbly factory configure` gets `--max-checks <n>` and `--check-memory-reserve <mb>`.
- `rowbly factory check add|update|remove|list` changes and shows the items.
- Settings › AI gets a Checks tab after the Limits tab.
- The supervisor loop reads `factory.json` again on each turn. A changed setting applies to the next
  admission. A restart is not necessary.

## The `run_check` worker tool

The factory manager gives each worker a `run_check` tool, in the same way as `report_result`
(`src/services/factory-worker/`). `openWorkerSession` in `factory-manager/worker-launch.ts` builds
it. `WORKER_TOOLS` in `pi-runtime/factory-session.ts` adds its name.

Input:

| Field   | Type              | Meaning                                                          |
| ------- | ----------------- | ---------------------------------------------------------------- |
| `check` | string            | The key of a configured check.                                   |
| `files` | string[], max 200 | Optional. The changed files. Then the tool runs `narrowCommand`. |

Rules:

1. An unknown `check` gives an error that lists the configured keys.
2. If the check has no `narrowCommand`, or `files` is empty, the tool runs the full `command`.
3. Each file must be a relative path inside the worktree. Otherwise the tool gives an error.
4. The tool waits until the check stops. It has no time limit of its own.
5. While the check waits or runs, the tool sends progress through `onUpdate`, for example
   `queued, position 2` or `running, 1m40s`.
6. If the Pi signal aborts the tool, the queue removes the job or stops its process group.

The result has these items:

- `status`: `passed`, `failed`, `timed_out`, `cancelled` or `error`.
- `exitCode`, `durationSeconds`, `scope` (`full` or `narrow`) and the Git `HEAD` of the worktree.
- The last 200 lines of output, with a maximum of 20000 characters.
- `log`: the path of the full output in `.rowbly/runtime/checks/<job id>.log`.

## The queue

The new `check-queue/` service holds the queue in the factory daemon. Inject the memory reader, the
process reader, the spawn function and the clock, so that tests do not start real checks.

### Order

1. The jobs of the Story nearest to the last Stage go first. This is the same order as the worker
   limit in `factory-policy/`.
2. Jobs of the same Stage go in the order of arrival.

### Admission

The queue starts the next job only if all these conditions are true:

1. Fewer than `maxConcurrent` jobs run.
2. `MemAvailable` from `/proc/meminfo`, minus `reserveMemoryMb`, is equal to or more than the
   estimate of the job.

If no job runs, the queue starts the next job also when condition 2 is false. Thus a large check
cannot wait without an end. The queue does the admission again when a job stops, when a job arrives,
and each 5 seconds while jobs wait.

The estimate of a job is the larger of `memoryMb` and the largest peak of the last 10 runs of the
same check key and scope.

### Process and memory

- A job runs through `bash -c` in the worktree of the worker. It uses the environment of the worker
  `bash` tool, with `ROWBLY_CHECK=1` in addition.
- Each job runs in its own process group (`detached: true`).
- Each second, the queue adds the RSS of all processes in the group, from `/proc/<pid>/status`. It
  records the peak.
- A timeout or a cancel sends SIGTERM to the group, then SIGKILL after 5 seconds.

### Records

- `.rowbly/runtime/checks/jobs.json` holds each job: id, Thread, Story, Stage, check key, scope,
  files, status, times, exit code, peak memory, and the process group with its Linux start ticks.
- The log of each job is `.rowbly/runtime/checks/<job id>.log`.
- The Thread metadata (`runtime/threads/<id>.json`) gets a short `checks` list: job id, check key,
  scope, status and `HEAD`.
- The queue keeps the records and the logs of the last 500 jobs.
- `runtime-files/` creates `runtime/checks/` with mode 0700. The existing `/runtime/` ignore rule
  keeps it out of Git.

## The bash gate

The worker `bash` tool (`workerBash` in `pi-runtime/factory-session.ts`) rejects a command before it
runs if the command contains the `command` text or a `block` text of a configured check.

- The rejection is a tool error: `Run this check with run_check: <key>`.
- The gate does not apply to the processes that the queue starts.
- The gate compares text. A worker that runs a check through a script file is not stopped. The
  prompt rule in the next section covers this case.

## Prompts and the digest

- `src/config/prompts/WORKER.md` tells the worker to run each check only through `run_check`. This
  text goes in only when the Project has checks.
- It also tells the worker to run the full check one time before `report_result`, after the last
  change.
- The worker system prompt has priority over the Stage prompt and the user prompts. Thus this rule
  applies also when a Stage prompt tells the worker to run a check in the shell.
- `runSection` in `src/services/messages/messages.ts` lists the configured checks: key, label and
  whether a narrow form exists.
- `buildDigest` in `factory-manager/supervisor-loop.ts` adds the checks to each entry of `workers`:
  the last full result, the last narrow result and the commit of each check key.
- The factory does not refuse a result without a full check. It records and shows the history.

## Status and TUI

- `status.json` gets `checks`: `running`, `queued`, `availableMb`, `maxConcurrent` and the jobs that
  run or wait.
- Factory controls show the counts of the running and queued checks.
- The thread pane (`src/tui/screens/threads/thread-pane/`) shows the checks of the selected Thread,
  with the status and the duration of each.

## Stop and recovery

- A normal stop cancels the queued jobs and stops each running process group.
- A cancel of a worker cancels its queued and running jobs.
- After the definite death of an owner, `factory-recovery/` reads `jobs.json`. It stops each process
  group whose leader still has the recorded start ticks. It marks these jobs `cancelled`.

## Documentation

- Add `docs/architecture/native-factory/checks.md`, and add it to the map of the sub-pages in
  `docs/architecture/native-factory/README.md`.
- Add the `checks` section to the factory settings in `pi-runtime-and-auth.md`.
- Add `runtime/checks/` to the file tree in `runtime-and-locks.md`.
- Add the new commands and the Checks tab to `controls.md`.

## Acceptance criteria

1. With `maxConcurrent: 2` and 4 workers that call `run_check` together, a maximum of 2 checks run at
   the same time. The other workers get `queued` progress, and then their results.
2. With `MemAvailable` minus the reserve below the estimate of the next job, that job waits while one
   or more jobs run. It starts when the memory is sufficient or when no job runs.
3. A worker bash command that contains `pnpm test` gives the gate error, and no process starts.
4. `run_check` with `files` runs `narrowCommand` with the shell-quoted files. Without `files`, it
   runs `command`.
5. The result of a check that fails has the exit code, the last output lines and a log path that
   exists.
6. A check that runs longer than `timeoutMinutes` gets the status `timed_out`, and its process group
   stops.
7. A cancel of a worker removes its queued jobs and stops its running job.
8. `rowbly factory stop` leaves no check process alive.
9. After a daemon crash and a new start, recovery stops the orphan check processes.
10. `status.json`, Factory controls and the thread pane show the running and queued checks.
11. The supervisor digest shows the check history of each worker.
12. Without a `checks` section, the factory works as before, and workers get no `run_check` tool.
13. Tests use the faux provider and fake memory and process readers. No test runs a real Pi model.
