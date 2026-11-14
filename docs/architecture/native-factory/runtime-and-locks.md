# Runtime files and locks

The native factory keeps private runtime files in `.rowbly/runtime/` and shared policy state in
`.rowbly/state.json`. Three locks protect these files and the canonical Project files. The lock order
and the ownership rules prevent two owners, lost writes and deadlocks.

Read this when you read or write a runtime file, `state.json` or `factory.json`, or when you take or
change a lock.

## Factory files in `.rowbly/`

```
.rowbly/
  factory.json        # optional committed settings: version, maxWorkers, supervisorModel, workerModel, git
  .gitignore          # /state.json* and /runtime/; existing text stays
  state.json          # v1 policy state; native factory or external supervisor writes it
  runtime/            # private, ignored; directories use mode 0700
    factory.lock      # daemon owner: token, PID, host, start time and Linux process identity
    lifecycle.guard   # short exclusive gate for ownership changes
    status.json       # heartbeat, workers, queue, holds, provider pauses and attention
    control/<id>.json # immutable stop, cancel, resume or dismiss request
    receipts/<id>.json # accepted, completed or rejected command result
    threads/<id>.json # small Thread metadata, with runs and exact session reference
    sessions/<id>/<pi-name>.jsonl # native Pi history; file reference starts as null
    bin/rowbly        # exact-version CLI shim for workers
    logs/<id>.jsonl   # operational logs; no transcript bodies
```

- `runtimePaths()` in `src/services/workspace/` gives each path. `runtime-files/` creates the private
  folders and owns the ignore rules.
- `state.json` uses version 1 of the factory skill format
  (`skills/factory/references/supervisor-policy.md`). The shared scripts keep unknown v1 keys.
- Without `factory.json`, the worker limit is four and Pi selects default models. See
  [pi-runtime-and-auth.md](pi-runtime-and-auth.md#factory-settings).

## Git and the runtime files

- Initialization creates `.rowbly/.gitignore` with `/state.json*` and `/runtime/`.
- Native start and `doctor --fix` add missing runtime ignore rules. Existing text stays.
- Canonical factory commits exclude runtime files, also when Git already tracks them.
- The factory commits the canonical files after each scan. The subject of the commit is
  `git.commitMessage` of `factory.json`. If it is not set, the subject is
  `chore(rowbly): record project changes after scan`. The body lists the changed paths.
- If `git.authorName` and `git.authorEmail` are set, they are the author and the committer of the
  commit. `commit-project.mjs --author "Name <email>"` sets them through the Git identity variables.
  Thus the commit works also when Git has no identity. If they are not set, Git uses its own
  identity.
- These settings apply only to the canonical commits. They do not apply to the commits of workers
  on Story branches.
- `rowbly doctor` reports runtime files that Git tracks.

Do not commit runtime files or credentials. Runtime files hold private sessions and process identity.

## The three locks

The factory uses three locks:

1. **Ownership.** `runtime/factory.lock` holds daemon ownership. `lifecycle.guard` serializes owner
   creation, takeover and release.
   - The Linux boot ID and the process start ticks protect against PID reuse.
   - A live, foreign, corrupt or uncertain owner prevents takeover.
   - An old heartbeat does not prove death.
2. **State.** `state.json.lock` serializes v1 state transactions and Thread metadata writes.
   - The shared scripts keep unknown v1 keys.
   - Do not hold this lock across model, Git or subprocess work.
3. **Project write.** The Git common directory holds the Project write lock. Its path comes from
   `commit-project.mjs::lockPath(root)`.
   - Native factory writers use util-linux `flock -w 60` for canonical changes and commits
     (`src/services/project-write/`).
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
- [../skills-and-stages.md](../skills-and-stages.md#factory-skill-files): the shared factory scripts.
