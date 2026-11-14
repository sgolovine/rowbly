# Runtime files and locks

The native factory keeps private runtime files in `.rowbly/runtime/` and shared policy state in
`.rowbly/state.json`. Three locks protect these files and the canonical Project files. The lock order
and the ownership rules prevent two owners, lost writes and deadlocks.

Read this when you read or write a runtime file, `state.json` or the factory settings, or when you
take or change a lock.

## Factory files in `.rowbly/`

```
.rowbly/
  rowbly.config.json  # the optional factory key: maxWorkers, supervisorModel, workerModel, stageWorkerModels, storyWorkerModels, git, checks
  .gitignore          # /state.json* and /runtime/; existing text stays
  state.json          # v1 policy state; the native factory writes it
  runtime/            # private, ignored; directories use mode 0700
    factory.lock      # daemon owner: token, PID, host, start time and Linux process identity
    lifecycle.guard   # short exclusive gate for ownership changes
    status.json       # heartbeat, workers, queue, holds, provider pauses, attention and checks
    control/<id>.json # immutable stop, cancel, resume or dismiss request
    receipts/<id>.json # accepted, completed or rejected command result
    threads/<id>.json # small Thread metadata, with runs and exact session reference
    sessions/<id>/<pi-name>.jsonl # native Pi history; file reference starts as null
    bin/rowbly        # exact-version CLI shim for workers
    logs/<id>.jsonl   # operational logs; no transcript bodies
    checks/jobs.json  # the records of the last 500 check jobs, with process group and start ticks
    checks/<id>.log   # the full output of one check job
```

- `runtimePaths()` in `src/services/workspace/` gives each path. `runtime-files/` creates the private
  folders and owns the ignore rules.
- `state.json` uses version 1 of the policy format. The types are in
  `src/services/factory-policy/policy-types.ts`. The `factory-state/` service keeps unknown v1 keys.
- Without the `factory` key of the config, the worker limit is four and Pi selects default models. See
  [pi-runtime-and-auth.md](pi-runtime-and-auth.md#factory-settings).
- `stageWorkerModels` and `storyWorkerModels` hold the worker model overrides of a Stage and of a
  Story in a Stage. A Story override has priority over a Stage override. A Stage override has
  priority over the `start_worker` model and `workerModel`. See
  [pi-runtime-and-auth.md](pi-runtime-and-auth.md#worker-model-overrides).

## Git and the runtime files

- Initialization creates `.rowbly/.gitignore` with `/state.json*` and `/runtime/`.
- Native start and `doctor --fix` add missing runtime ignore rules. Existing text stays.
- Canonical factory commits exclude runtime files, also when Git already tracks them.
- The factory commits the canonical files after each scan. The subject of the commit is
  `git.commitMessage` of the factory settings. If it is not set, the subject is
  `chore(rowbly): record project changes after scan`. The body lists the changed paths.
- If `git.authorName` and `git.authorEmail` are set, they are the author and the committer of the
  commit. `commitProjectFiles()` in `project-write/project-commit.ts` sets them through the Git
  identity variables. Thus the commit works also when Git has no identity. If they are not set, Git uses its own
  identity.
- These settings apply only to the canonical commits. They do not apply to the commits of workers
  on Story branches.
- `rowbly doctor` reports runtime files that Git tracks.

Do not commit runtime files or credentials. Runtime files hold private sessions and process identity.

## Git sync of the canonical checkout

The native factory can pull the upstream branch and push the canonical branch at an interval. The
`git` section of the factory settings holds the settings:

| Key                   | Type    | Default | Meaning                                               |
| --------------------- | ------- | ------- | ----------------------------------------------------- |
| `push`                | boolean | `false` | Push the local commits of the canonical branch.       |
| `pull`                | boolean | `false` | Pull the commits of the upstream branch.              |
| `syncIntervalSeconds` | integer | `300`   | The time between two syncs. The range is 60 to 86400. |

- `getFactorySettings` gives the default of each key that is not in the config. A write does not add
  the defaults to the config. An update keeps the other keys of the `git` section, for example
  `commitMessage`, `authorName` and `authorEmail`.
- `project-sync/` (`syncCanonicalProject`) does one sync. With `push` and `pull` off, it runs no Git
  command.
- The sync runs Git commands while it holds the Project write lock (`projectWrite`). It does not
  hold the state lock.
- Each Git command has a timeout of 120 seconds. Git does not ask for credentials.
- The pull runs first. It needs a branch with an upstream, and no merge in progress. It runs
  `git fetch`, then `git merge --ff-only @{u}`. If the branches diverged, it runs
  `git merge --no-edit @{u}`. If the merge fails, it runs `git merge --abort`.
- The push runs also after a failed pull. If `git rev-list --count @{u}..HEAD` is 0, the push is
  `skipped`. Else it runs `git push`. It never uses force.
- The sync does not rebase, stash or change uncommitted files. It does not sync worker worktrees or
  Story branches. The `.gitignore` rules keep `state.json*` and `runtime/` out of the merge.
- The supervisor loop starts a sync after the canonical commit of a scan. The first sync runs at the
  first scan after start. The next sync runs at the first scan after `syncIntervalSeconds`. The loop
  reads the interval again at each scan. A scan occurs at least each 30 seconds.
- Only one sync runs at a time. The sync runs outside the serial queue, so a slow network does not
  stop the reconcile. While a sync runs, the canonical commit waits for the next scan.
- A stop waits for a running sync, so that Git does not continue after the release of the lock.
- A failed pull sets the attention entry `pull`. A failed push sets the attention entry `push`. The
  text has the Git error, limited to 500 characters. The factory continues to run. A pull or push
  that does not fail removes its entry.

## The three locks

The factory uses three locks:

1. **Ownership.** `runtime/factory.lock` holds daemon ownership. `lifecycle.guard` serializes owner
   creation, takeover and release.
   - The Linux boot ID and the process start ticks protect against PID reuse.
   - A live, foreign, corrupt or uncertain owner prevents takeover.
   - An old heartbeat does not prove death.
2. **State.** `state.json.lock` serializes v1 state transactions and Thread metadata writes.
   - The `factory-state/` service keeps unknown v1 keys.
   - Do not hold this lock across model, Git or subprocess work.
3. **Project write.** The Git common directory holds the Project write lock. Its path comes from
   `lockPath(root)` in `src/services/project-write/project-commit.ts`.
   - Native factory writers use util-linux `flock -w 60` for canonical changes, commits and the Git
     sync (`src/services/project-write/`).
   - Workers use the exact CLI shim under the same lock. There is no unlocked fallback.

## Lock rules

- Never take the Project write lock while you hold the state lock.
- No kernel lock spans a model request.
- Existing human CLI and TUI writes keep their previous concurrency limits. They do not take the
  Project write lock.
- A crash inside a lifecycle guard can leave the guard in place. Do not remove a guard because of
  its age.
- Before an offline repair, make sure that all relevant factory processes have stopped.

## Related

- [recovery.md](recovery.md): what happens after an owner dies.
- [../storage.md](../storage.md): the other files in `.rowbly/`.
- [../service-layer.md](../service-layer.md#native-factory): the factory services.
