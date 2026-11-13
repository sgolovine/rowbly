# Supervisor policy

`scripts/supervisor-policy.mjs` holds the assignment rules of the factory. It does no I/O.
`scripts/factory.mjs scan` supplies the facts, calls the policy, saves the state and prints the decisions.
The external supervisor uses `factory.mjs`. It does not call the policy directly.

## Native execution and external compatibility

The native manager uses the same v1 policy through `factoryPolicy` and `factoryState`.
The external harness path uses `factory.mjs`. Never run both supervisors together.
Updated external scripts check native ownership before work and inside assignment transactions.
Old installed scripts do not honor native ownership or the stronger state lock protocol.

Native `runtime/factory.lock` records daemon ownership. `runtime/lifecycle.guard` serializes owner changes.
Only definite owner death permits takeover. An old heartbeat does not prove death.
A corrupt, foreign or uncertain owner prevents takeover.

A guard left after a crash needs offline repair after all relevant factory processes have stopped.
Never remove a guard because of its age.

Both paths use `state.json.lock` for state transactions. Unknown v1 keys stay intact.
Native factory writes to canonical Project files use the shared Git common-directory lock through util-linux `flock`.
Native workers use the exact CLI shim under that lock. They have no unlocked fallback.

Do not acquire the Project write lock while the state lock is held.
Do not hold either lock across a model request. Existing human CLI and TUI writes retain their previous concurrency limits.
Native execution requires Linux, Git and local files. Multi-host and NFS ownership are not supported.

A native Thread is one Pi session and one policy attempt. Its UUID is also the v1 `workerId`.
The native manager saves pending intent before the v1 `preparing` attempt and before worktree or session creation.
Pending occupies a worker slot. A Story that waits for capacity has no fictitious Thread.

Recovery repairs the two-file projection by Thread ID without duplicate attempts.
Native cancellation maps to v1 `interrupted` and saves a Story/Stage/content hold.
Release, explicit resume or a material Story change clears that hold.

Resume adds a run to the same Thread and reuses the exact session and policy attempt.
The Story must remain in its original Stage. The session file and original worktree must exist.

The manager checks policy eligibility. Completed Threads cannot resume. Each Thread has at most three runs.
A new retry creates a new Thread. Supervisor rotation creates a new Factory Thread with a predecessor link.

Normal stop aborts Pi sessions and preserves histories and worktrees.
After definite daemon death, recovery marks active runs interrupted.
A worker is resumable only with a session file and its Story in the original Stage.
Shell descendants started by a crashed daemon are not tracked. Normal stop relies on Pi abort for shell children.

Do not assume exactly-once shell effects.
Native start preserves external active attempts unless `--adopt-external` marks them interrupted.
Stop external workers first. Adoption does not stop workers or import their conversations.

The native loop observes file changes, worker results and retry or hold deadlines.
It sends bounded operational digests without worker transcripts. Explicit history inspection has twenty entries and a 4 KiB text limit.
Report delivery is at least once. The manager acknowledges reports after a successful supervisor turn.

Unanswered decisions use bounded backoff. An idle factory makes no provider requests.
The native snapshot persists holds, provider pauses, attention, report checkpoints and queue reasons.
The AI selects eligible work; there is no deterministic launch fallback.

## Facts

`evaluateScan(state, facts)` plans one scan. `factory.mjs scan` collects these facts:

| Fact             | Source                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------- |
| `stories`        | `rowbly -C <root> --json story search`                                                   |
| `stages`         | The config, in board order, with `{ key, enabled, promptClass }` for each Stage          |
| `harnessWorkers` | The `--worker <id>=<status>=<result>` and `--busy <story>` options of the supervisor     |
| `maxActive`      | The last `--max-active <n>` option, which the state keeps. Without it, the number of workers has no limit. |
| `now`            | The clock                                                                                |

A `promptClass` is `work`, `hold`, `invalid`, `missing` or `unclassified`.

- `missing`: `.rowbly/stages/<KEY>.md` does not exist.
- `invalid`: the file is empty, or the supervisor gave it the class `invalid`.
- `unclassified`: the supervisor did not classify the current text of the file.
- `work` or `hold`: the class that the supervisor saved with `factory.mjs classify`.

The state keeps a hash of each prompt with its class. A prompt that changes becomes `unclassified` again.

`normalizeStatus` changes a status name of the harness to a status of the state file.
An unknown name counts as `running`. A worker with no status also counts as a worker that runs.
`factory.mjs scan` thus asks for the status of each active worker before it calls the policy.

One Story file that Rowbly cannot read makes `story search` fail. `scan` then reads each Story with `story get`.
A Story that fails gets no worker, and `scan` reports it one time. All other Stories continue.

## Decisions

Each Story gets one decision, with an `action` and a `reason`. The actions are `start`, `retry` and `skip`.
The policy examines these conditions in order and uses the first one that applies:

| #   | Condition                                                               | Decision                                         |
| --- | ----------------------------------------------------------------------- | ------------------------------------------------ |
| 1   | The Stage is absent from the config or has `enabled: false`.            | `skip`: stage unavailable                        |
| 2   | The prompt is `missing` or `invalid`.                                   | `skip`: stage prompt missing or invalid          |
| 3   | The prompt is `unclassified`.                                           | `skip`: stage prompt not classified              |
| 4   | The prompt is `hold`.                                                   | `skip`: hold stage                               |
| 5   | A `--busy` Story, or a harness worker of the Story still runs.          | `skip`: active or unknown harness worker         |
| 6   | An attempt of the Story has an active status.                           | `skip`: worker stop unconfirmed                  |
| 7   | The Story is parked.                                                    | `skip`: parked                                   |
| 8   | This scan first confirmed the stop of the last worker in this Stage stay. | `skip`: stop confirmed this scan               |
| 9   | 4 workers stopped normally for this Story in this Stage.                | `skip`: parked. The policy parks the Story.      |
| 10  | The Story has no attempt, or it entered the Stage after its last attempt. | `start`: new stage stay                        |
| 11  | The last worker stopped normally and the Story did not move.            | `retry`: worker stopped without a stage move     |
| 12  | The last worker failed or was interrupted, and its delay is not complete. | `skip`: retry delay, with `retryAt`            |
| 13  | The last worker failed or was interrupted.                              | `retry`: worker failed                           |

A launch that gave no worker (`factory.mjs launch-failed`) changes the `start` or `retry` decision of its Story to `skip`: launch delay.
The delay is 2 minutes, then twice as long after each failed launch in a row, to a maximum of 60 minutes. A worker that starts removes it.

After these decisions, `maxActive` changes the `start` and `retry` decisions above the limit to `skip`: worker limit.
The Stories nearest to the last Stage keep their decision first, then the Stories in board order.

A `start` or `retry` decision has the number of the `attempt`. A `retry` decision also has the `previous` worker.

### Stops, failures and delays

A worker "stops normally" when its status is `completed` or `blocked`. The result text does not change the decision.
Only the Stage of the Story shows progress. A Story that moved gets a worker for its new Stage in the same scan.

A worker "fails" when its status is `failed` or `interrupted`. The first failure gets a new worker on the next scan.
Each later failure in a row doubles the delay: 2, 4, 8, 16 and 32 minutes, then 60 minutes each time.
Failures have no limit, because their cause is frequently temporary. An example is a usage limit that resets.

### Parked Stories

The limit of 4 workers counts the workers that stopped normally for one Story in one Stage.
It counts all stays in that Stage. Thus it also stops a Story that moves between two Stages without an end.
Failed and interrupted workers do not count.

A parked Story gets no worker. The policy removes the Story from `parked` and starts the count from zero in these conditions:

- The title, the description or a field of the Story changed.
- The Story moved to a different Stage.
- The supervisor ran `factory.mjs release` after a request from the user.

The count of a Story also starts from zero when a scan sees the Story in a `hold` Stage.

### Workers that run for a long time

`evaluateScan` also gives `stalled`: the active workers that started 90 minutes or more before the scan.
`factory.mjs scan` then tells the supervisor to examine the worker. It repeats this action each 30 minutes.

`DEFAULT_LIMITS` in the policy holds the limits: `attempts`, `retryMinutes`, `retryCapMinutes` and `stallMinutes`.

## Saved records

`factory.mjs` saves all persistent state through `factory-state.mjs`. That module validates the state, sets `updatedAt`,
flushes a temporary file, then replaces `state.json` atomically. Do not write the file in another way.

Use version 1 of the state format. Keep additional fields of the state and of the attempt records.
`attempts` contains all attempts in launch order. Do not remove an attempt.
Rowbly reads `version`, `scan` and `attempts` to show the factory activity in the TUI.

```json
{
  "version": 1,
  "updatedAt": "2026-11-10T12:00:00.000Z",
  "scan": {
    "count": 12,
    "idle": 0,
    "stages": { "ROW-01": "IN_REFINEMENT" }
  },
  "attempts": [
    {
      "story": "ROW-01",
      "stage": "IN_REFINEMENT",
      "workerId": "worker-1",
      "workerType": "thread",
      "model": "gpt-sol",
      "status": "interrupted",
      "result": "interrupted",
      "startedAt": "2026-11-10T11:00:00.000Z",
      "stoppedAt": "2026-11-10T12:00:00.000Z",
      "stoppedScan": 11,
      "reported": true,
      "startReported": true
    }
  ],
  "parked": {
    "ROW-02": {
      "stage": "IN_REVIEW",
      "reason": "4 workers stopped and the Story did not move",
      "hash": "0f3a9c1d2b4e5f60",
      "since": "2026-11-10T11:30:00.000Z",
      "reported": true
    }
  },
  "prompts": { "IN_REFINEMENT": { "hash": "6b1d0c9e8f7a2b3c", "class": "work" } },
  "notes": ["rook does not answer; workers run on thinkpad"],
  "maxActive": 3,
  "launchFailures": { "ROW-03": { "count": 2, "at": "2026-11-10T11:50:00.000Z", "error": "usage limit reached" } },
  "writeLock": "/path/to/project/.git/rowbly-project-write.lock"
}
```

- The attempt statuses are `preparing`, `running`, `completed`, `failed`, `blocked` and `interrupted`.
- `scan.count` increases once per scan and persists across restarts. `scan.stages` records the Stage of each Story at that scan.
- `scan.idle` counts the scans in a row without a worker, a start or a Story that waits.
- `stoppedScan` records the first scan that confirmed a stop. A terminal record without `stoppedScan` counts as an earlier stop.
- `observedStageDeparture` on an attempt shows that a scan saw the Story in a different Stage after the attempt.
- `budgetReset` on an attempt shows that the attempt no longer counts against the limit of 4 workers.
- `reported` and `startReported` prevent a second report of the same event. `scan` sets them when it prints the report.
- `rowbly` holds a different Rowbly command, if the supervisor gave one to `check`.
- `problems` and `commitProblem` hold the problems that `scan` reported, so that it reports each one only one time.
- `rowblyFailures` counts the scans in a row on which the Rowbly command failed.

Each command that changes the state holds the lock file `state.json.lock` from its read to its write.
Thus a scan cannot replace the record of a worker that started during the scan.

`factory.mjs reset-state` moves a file that is not valid to `state.json.invalid-<time>`. It starts a new state with each valid part
of the old file: the valid attempts, the scan count, the prompt classes, the notes and the limit of workers.

A crash between the report of `scan` and the message of the supervisor can lose that message. The state keeps the result.

## Commits of the Project files

`scripts/commit-project.mjs` commits the canonical Project state. `scan` calls it after each scan.

- It commits only files inside `<root>/.rowbly/` that Git does not ignore. It includes new, changed and deleted files.
- It always excludes `.rowbly/state.json` and each file with a name that starts with `state.json.`.
- It holds the shared write lock from the Git status check through the end of the commit.
- It uses explicit, literal paths with `git add --all -- <paths>` and `git commit --only -- <paths>`.
- It does not commit source files, and it keeps unrelated staged changes as they are.
- It does not push, reset, amend or bypass a hook.

The lock is `rowbly-project-write.lock` in the common Git directory, or `<root>/.rowbly-factory-write.lock` without Git.
`check` saves the path in `writeLock`. Workers get the same path in their first message.
The lock coordinates only the writers that use it.

| `status`    | Meaning                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------ |
| `committed` | A new commit holds the `paths`.                                                                  |
| `clean`     | No Project file changed.                                                                         |
| `held`      | Each changed file has a staged version and a later edit. The command does not overwrite a staged version. |
| `conflict`  | A Project file has a merge conflict. The command changes nothing.                                |
| `no-git`    | The Project is not in a Git repository. The factory continues without commits.                   |
| `failed`    | A Git command failed or the lock stayed busy for 60 seconds. `detail` has the error text.        |

A commit problem does not stop the factory. `scan` tries again on the next scan.
The commit message names the Story when exactly one Story moved, for example `chore(rowbly): record ROW-06 move to in review`.
