# ADR-0019: Operations are coordinated per Data Root and committed through a recoverable journal

**Status:** Accepted. Built. [Storage and commits](../../architecture/storage.md) and the [Plugin API reference](../../plugins/api.md#transactions-and-concurrency) summarize it. Amended narrowly by [ADR-0034](0034-git-synchronization-publishes-recoverably.md). Amended by [ADR-0036](0036-binary-plugin-files-use-the-commit-journal.md): binary Plugin files use the same journal.

An operation (ADR-0012) used to read the Data Root freely and then save its Change Set file by file. Two processes could plan from the same records and lose one another's changes, or hand out the same Story Key. A failure halfway through a save left part of the operation on disk. A failed folder move could leave a Story in a hidden `.moving` folder, and a failed text write could truncate the original file. This ADR sets the contract that fixes these problems. Rowbly keeps its JSON and Markdown files (ADR-0001). Each Data Root gets one lock, and a Change Set is committed through a small on-disk journal that Rowbly recovers before it reads. ADR-0020 covers what Plugins see while an operation runs.

We rejected these alternatives: SQLite or another database (ADR-0001), a lock held only around `save()`, and in-memory rollback. A lock around `save()` alone cannot prevent duplicate Story Keys, because the plan is already stale when the lock is taken. In-memory rollback does not survive the death of the process. We also rejected a general transaction DSL, a distributed lock service and a transaction manager per Plugin.

## 1. The lock

**Mechanism.** A lock file, `.lock`, at the top of the Data Root (beside `rowbly.config.json`). It is created with exclusive create (`open(path, 'wx')`). Its content is JSON: `{ "pid": number, "host": string, "startedAt": ISO timestamp, "token": random string, "operation": string }`. The process that created the file holds the lock. Release means that the holder unlinks the file after checking that `token` is still its own.

**Canonical root.** The Data Root is canonicalized with `realpath` once, when it is opened. The lock file, the journal and all physical paths in a plan come from the canonical path. Because the lock file lives inside the Data Root, aliases (a symlinked Data Root, `--data-root` given with `..`, a different working directory) always share one lock. The in-process lock table is keyed by the canonical path.

**In-process queue.** Inside one process, acquisitions for the same canonical root first wait in a FIFO promise queue. Then the file is created, so that one process never polls against itself. A TUI Action that runs while a background step is pending waits in this queue. It is not rejected.

**Waiting and timeout.** Acquisition retries with backoff (25 ms doubling up to 250 ms, with jitter) for at most **10 s** by default. Tests may pass a smaller `timeoutMs`. On timeout it throws `ConflictError` (exit 4): `Data Root is busy: another Rowbly process (pid <pid> on <host>, since <startedAt>) is saving`. The error has `details: { lock: <path>, pid, host, startedAt }` and the hint `try again; if no Rowbly process is running, delete <path>`.

**Stale holders.** A lock is stale when one of these holds:

- its `host` equals `os.hostname()` and `process.kill(pid, 0)` reports `ESRCH` (the process is gone);
- it is older than **10 minutes**, judged by `startedAt` or, when the content is unreadable, by the file's mtime. This covers a reused pid, another host on a shared filesystem, and a truncated lock file.

An operation never waits for a person while it holds the lock. Editor input, confirmations and prompts happen before `ops.run`, so 10 minutes is far beyond any real operation. To break a stale lock, a waiter takes a second lock, `.lock.break`, by exclusive create. That lock is itself stale after 30 s. The waiter then reads `.lock` again, confirms that it is still the same stale token, unlinks it, releases `.lock.break` and retries the exclusive create. Two waiters can therefore never both break a lock and then delete a fresh one.

**Release on every path.** Acquisition returns a handle that is released in a `finally` (or `await using`). This covers a thrown body, a hook or validation failure, a failed commit and a failed recovery. A release that finds a different token (because its lock was broken as stale) does nothing and warns.

**What takes the lock.** Every mutation takes it exclusively:

- core service operations and Plugin operations (`ops.run`);
- `doctor --fix` passes, and `doctor` analysis that produces a fix plan;
- configuration changes;
- Local State changes;
- `plugins enable`/`disable`;
- recovery.

The lock is taken **before** the operation reads anything that it uses to plan. That includes Local State and the context's current Board and Me, which are read again under the lock (§8). It is held through the body, the hooks, final validation, commit and in-process recovery. It is released **before** reactions run.

**Reads take it too.** Participating readers use the same lock (§5). We considered a shared/exclusive scheme, but it is hard to build portably on exclusive-create files, and Rowbly reads are short. The cost is that two concurrent read-only commands run one after the other for a few milliseconds.

**Reentrancy.** The held handle is stored in the operation's execution scope (ADR-0020, `AsyncLocalStorage`). Reads inside the operation, including Plugin `files.read`, repository reads by services and reads by hooks, reuse the handle without acquiring again. Starting a *mutation* inside the scope is rejected by ADR-0020 §2 before it reaches the lock. If an acquisition still finds the lock held by its own async scope, it throws an internal error at once. It never waits for itself.

**External tools.** Editors, Git, `cat` and scripts do not take the lock. Rowbly does not claim to protect against them. It detects what it can: conflict markers, schema failures, identity checks at final validation (§6), and leftovers that doctor reports (§9).

## 2. The journal

**Layout.** Each commit has its own folder, `.txn/<id>/`, at the top of the canonical Data Root:

```text
.rowbly/
  .lock                     the lock (§1)
  .lock.break               present only while a stale lock is being broken
  .txn/
    <id>/                   one transaction; <id> = <UTC yyyymmddThhmmssSSSZ>-<8 hex>, so ids sort by time
      manifest.json         written once, atomically, at the commit point
      staged/<n>            the new content of each written file
      moving/<n>            Story folders between their old and new place
      trash/<n>             deleted files and folders, until the transaction completes
```

**Manifest schema** (version 1). Every path is `/`-separated. Paths that start with `staged/`, `moving/` or `trash/` are relative to the transaction folder. All other paths are relative to the canonical Data Root.

```ts
interface TransactionManifest {
  version: 1;
  id: string;
  /** The operation name, e.g. `stories.create` or `epics.delete`. */
  operation: string;
  createdAt: string; // ISO timestamp from the operation clock
  pid: number;
  host: string;
  /** `prepared` is the commit point; `complete` means every step is done and only cleanup remains. */
  phase: 'prepared' | 'complete';
  /** In apply order (see below). */
  steps: TransactionStep[];
}

type TransactionStep =
  /** A Story folder leaves its old place (renumbering, including swaps). */
  | { kind: 'moveOut'; from: string; temp: string }
  /** A record file, a Story or Board folder, or a Plugin file is deleted. */
  | { kind: 'delete'; path: string; entry: 'file' | 'folder'; trash: string; pruneTo?: string }
  /** A Story folder arrives at its new place. */
  | { kind: 'moveIn'; temp: string; to: string }
  /** A record or Plugin file is created or replaced. */
  | { kind: 'write'; path: string; staged: string; existed: boolean };
```

`pruneTo` is the record folder above a Plugin file's `plugins/` folder. After a Plugin file is deleted, its empty folders are removed up to `pruneTo`, as the current code does. The final paths in the manifest are the original, staged and final locations that recovery needs. For each move, `from` is the original, `temp` is the staged location and `to` is the final one.

**Commit sequence.** All of it runs under the lock.

1. **Validate** the sealed final plan in full (§6). If validation fails, throw before anything is written. Nothing is saved.
2. **Stage.** Create `.txn/<id>/`. Write each new file's content to `staged/<n>`, and fsync each file (§3). A failure here removes the transaction folder, best effort, and rethrows. Nothing live has changed.
3. **Prepare (the commit point).** Write the manifest with `phase: 'prepared'` to a temporary file in the transaction folder. Fsync it, rename it to `manifest.json`, then fsync the transaction folder and `.txn/`. From this moment the operation is committed. It finishes now or at the next recovery.
4. **Apply**, in this order: every `moveOut`, then every `delete`, then every `moveIn`, then every `write`.
   - A `delete` renames its target into `trash/`.
   - A `write` creates missing parent folders and renames `staged/<n>` over `path`.
   - After the steps, fsync the touched parent folders where the platform supports it.
5. **Complete.** Atomically replace the manifest with `phase: 'complete'`, then remove the transaction folder (including `trash/`) recursively.

Moves out happen before deletions, so a key that is deleted and re-allocated in the same plan never collides. Writes happen last, so a file written into a renumbered Story lands in its final folder. Validation (§6) guarantees that no `write` lands beneath a deleted Board or Story, so creating parent folders never revives a deleted parent.

**Recovery policy.** Recovery has one rule per phase.

| Found in `.txn/<id>/` | Meaning | Recovery |
| --- | --- | --- |
| No `manifest.json` | Unprepared. Staging was interrupted. Nothing live was touched. | Remove the folder (this restores the originals, which were never changed). |
| `phase: 'prepared'` | Committed but maybe not fully applied. | **Roll forward**: run every step again, idempotently, then complete. |
| `phase: 'complete'` | Applied. Cleanup was interrupted. | Remove the folder. |

Each step can be retried, so recovery is **idempotent** and safe to interrupt and run again:

- `moveOut`: if `from` exists and `temp` doesn't, rename it. If `temp` exists, the step is done.
- `delete`: if `path` exists and `trash` doesn't, rename it into the trash. If `path` is missing, the step is done. Pruning ignores folders that are missing or not empty.
- `moveIn`: if `temp` exists, create the parent folder and rename it to `to`. If `temp` is missing and `to` exists, the step is done.
- `write`: if `staged` exists, rename it over `path`. If `staged` is missing, the step is done.

A step that is neither done nor possible is a recovery failure. One example is a `moveIn` whose `temp` and `to` are both missing.

**When recovery runs.** Every lock acquisition, whether for a mutation or for a read scope (§5), lists `.txn/` right after taking the lock and recovers each entry in id order before it returns the handle. The lock prevents a second prepared transaction from starting while one is unrecovered, so there is at most one prepared transaction. There may be several unprepared leftovers. Interrupted transactions therefore never leave reserved Story Keys behind. A prepared one is rolled forward before anyone plans again, and an unprepared one never took effect.

**Failure during apply in the running process.** The process retries the remaining steps once, as a roll-forward, while it still holds the lock. If that succeeds, the operation succeeds. If it fails, the operation throws `DataIntegrityError` (exit 6): `<operation> was saved only in part; Rowbly finishes it before the next read or change`. The error has `details: { transaction: <id>, pending: [paths], cause }` and the hint `fix the cause (for example file permissions), then run \`rowbly doctor\``. Reactions do not run. The error never says "nothing saved".

**Recovery failure at acquisition.** If recovery fails when the lock is taken, the acquisition fails with the same `DataIntegrityError`, for reads and for mutations. Participating readers must never see a half-applied commit (§5). The one exception is `rowbly doctor`, which reports `TRANSACTION_PENDING` (§9) and does nothing else in that run.

**Gitignore.** Journal and lock artifacts are never Git data. `rowbly init` writes the Data Root's `.gitignore` as:

```gitignore
local.json
.lock
.lock.break
.txn/
```

For existing Data Roots, doctor reports `GITIGNORE_INCOMPLETE` and its fix appends the missing lines (§9).

## 3. Durability

**Covered:** the death of the Rowbly process at any instant. That includes a crash, `kill -9`, an out-of-memory kill and Ctrl-C. After recovery the Data Root holds the complete old state or the complete new state of the operation.

**Not guaranteed:** power loss, a kernel crash or storage that loses acknowledged writes. Rowbly fsyncs on a best-effort basis to make those cases unlikely, but does not promise them:

- every staged file is fsynced before prepare;
- the manifest is fsynced before its rename;
- the transaction folder and `.txn/` are fsynced after the rename;
- touched parent folders are fsynced after apply.

Folder fsync is skipped where the platform does not support it (Windows, and errors such as `EISDIR`/`EPERM` on folder handles). Rowbly does not use `F_FULLFSYNC` on macOS.

**Atomic single-file writes.** `writeTextFile`, and every other single-file write outside a transaction (for example `rowbly init`), writes to a unique temporary file in the same folder: `.<name>.<8 hex>.tmp`. It fsyncs that file and renames it over the destination. A failed write removes the temporary file, best effort, and rethrows the *original* error. The destination is never truncated. JSON keeps its current serialization: schema key order, two-space indent, a trailing newline.

**One filesystem.** Staging renames files from `.txn/` into place. The whole Data Root must therefore be on one filesystem. Preparation compares the device of `.txn/` with the device of each destination's nearest existing parent folder. On a mismatch it throws `ValidationError` before staging, rather than failing with `EXDEV` halfway through.

## 4. Logical file scopes

A pending Plugin file change does not store a physical path. It stores:

```ts
interface PendingFileChange {
  plugin: string;            // Plugin id
  scope: ScopeRef;           // which plugins/<id>/ folder
  name: string;              // relative name, checked by FILE_NAME_RE (no '.', '..', absolute paths)
  before: string | null;     // stored text when first touched
  after: string | null;      // null = delete
}

type ScopeRef =
  | { kind: 'dataRoot' }
  | { kind: 'board'; record: BoardEntry }   // private plan entry, not a slug
  | { kind: 'story'; record: StoryEntry };  // private plan entry, not a key
```

`BoardEntry` and `StoryEntry` are the plan's private entries (§7). Each holds the record's **original storage identity** (Board id, or Board id, Story Key and physical folder) and its pending `after`. The physical path is resolved at **commit preparation** from the entry's final `after`. A Story that is renumbered after its file was queued therefore takes the file with it. The public `FileChange.path` that views show is computed from the current plan when the snapshot is taken.

**Scope lookup has three results** for Boards and Stories: `absent` (not in the plan: read from disk), `present` (the plan's pending record) and `deleted` (the plan deletes it, or deletes its Board).

| Situation | Rule |
| --- | --- |
| Read or list a `deleted` scope | Returns `null` / `[]`. It never falls back to disk. |
| Write a file in a `deleted` scope | `ConflictError` at the call, before save: `Plugin "<id>" cannot write <name>: its Story <KEY> is being deleted` (or `Board`). |
| A file was queued, then its Story or Board is deleted in the same plan | Final validation (§6) rejects the plan with the same `ConflictError`. A queued file *deletion* in that scope is dropped, because the cascade removes it. |
| A Board or Story created in this plan | Can hold files in the same operation. Its folder is created by the `write` steps. |
| A Story renumbered before or after its file was queued | The file follows the Story to its final folder. |
| A parent is deleted, then the same Board id or Story Key is put again in one plan | `ConflictError` before save. A deletion is never followed by recreating the same record. |
| A whole Board or Story folder is deleted | One `delete` step for the folder. It removes every Plugin's files, including those of Plugins that are off or unknown. The plan does not list them as separate file changes. |

Story Keys and Board membership never change through ordinary `updateStory`. A Plugin writer whose update changes `key` or `boardId` gets a `ValidationError` at the call. Renumbering is done only by core doctor, through the private `recordStory` path. A Story never moves to another Board.

## 5. Participating readers

A *participating reader* is any Rowbly code that reads the Data Root through repositories or Plugin file reads. That includes CLI commands, TUI screens, Plugin rows and filters, and doctor.

- **Read scopes.** A top-level read that runs outside an operation takes the lock for the duration of that call, recovers if needed (§2), reads and releases. One service read method is one read scope, for example `stories.list`, `boards.get` or a Plugin `files.read` from a screen. Inside an operation, reads reuse the operation's handle.
- **Result.** A participating reader never observes a half-applied commit. Each read scope sees one committed state. Two consecutive scopes may see two different committed states. Freshness between scopes, such as when a TUI screen reloads, is not part of this contract.
- **Caches** of repository data last at most one operation or one read scope. They are dropped on each acquisition.
- **External readers** (editors, Git, `cat`, scripts) can see intermediate files while a commit is applied: staged files inside `.txn/`, and records already renamed while others are not. They can also see files after a crash until the next Rowbly command recovers them. This is documented. Rowbly never describes a commit as instantaneous multi-file atomicity.

## 6. Final-plan validation

When the plan is sealed for commit, the engine checks all of the following. It reads disk under the lock. Any failure throws before staging, and nothing is saved. Each check names the record or path that failed.

1. **Record schemas.** Every pending `after` parses with its schema (`StorySchema`, `BoardConfigSchema`, `RowblyConfigSchema`, `LocalStateSchema`) and serializes. Plugin bags keep their raw values, so an invalid or unknown bag that was not changed passes unchanged (ADR-0020 §3). The failure is `ValidationError` with `details.issues`.
2. **Source identities.** For each update or delete, the private original identity still exists on disk: the Story's physical folder and `story.json`, or the Board's folder. For each create, the destination is free. Snapshots (ADR-0020) cannot change these identities. Changing `before.key` in a view cannot redirect a deletion. The failure is `ConflictError`.
3. **Immutable identity.** For each Story that is not renumbered through doctor's private path, `after.key` and `after.boardId` equal the original. The failure is `ValidationError`.
4. **Parent lifecycle.** Every pending Story's Board exists in the final state: on disk and not deleted, or created in the plan. No record or file write lies beneath a Board or Story that the plan deletes. A Board or Story is not deleted and then put again. The failure is `ConflictError`.
5. **Uniqueness.** No two final Stories share a Story Key. No two Story changes resolve to the same folder. No two Boards share an id or a key prefix. The failure is `ConflictError`.
6. **Moves.** Each source exists. No two moves share a destination. A destination may be occupied only by a folder that the same plan moves away or deletes. An occupied orphan folder (one with no valid `story.json`) is never a free destination or a free key. The failure is `ConflictError`.
7. **Path containment.** Every final physical path lies inside the canonical Data Root. Record paths are built only from validated slugs and Story Keys. Plugin file paths are inside their scope's `plugins/<id>/` folder, use checked relative names, and follow the symlink policy (§10). The failure is `ValidationError`.
8. **Same filesystem** (§3). The failure is `ValidationError`.
9. **Reserved settings.** A root config change made from a Plugin stage leaves every `plugins.<id>.enabled` value as it was. Enablement changes only through the plugins service. This backs up ADR-0020's runtime `writeBag` rejection. The failure is `PluginError`, attributed.

## 7. Private storage identity

The Change Set keeps one private entry per record. The entry holds the original identity (the physical source folder or path, read when the record first entered the plan), the read-time `before` and the pending `after`. It is never handed to a Plugin. Plugins receive detached snapshots and stage-bound writers (ADR-0020 §1). Commit preparation derives every `delete`, `moveOut`/`moveIn` and `write` step from these entries and from `PendingFileChange` scopes. It never derives them from a snapshot's `before` or `after`. `doctor --fix` gives the physical source folder of a Story it splits or renumbers through `recordStory(before, after, beforeFolder)`, which only core can reach.

## 8. Stale context

The `RowblyContext` caches `local` (Local State) and `me`. An operation must not plan from those caches:

- Under the lock, services read Local State and records through the Change Set (`updateLocalState`, `updateStory`, …), which reads the latest pending or stored version. They never rewrite from `ctx.local`.
- After a successful commit, and before reactions, the runner copies the committed Local State into `ctx.local` in one synchronization step. That step serves every operation, including Plugin operations and doctor fixes. It sets `ctx.me` again only if the stored Me selection changed. Otherwise it keeps a Me that was inferred from the git email.
- A rejected or failed operation does not synchronize.

## 9. Doctor findings for leftovers

Doctor treats `.lock`, `.lock.break` and everything under `.txn/` as Rowbly's own files. They never appear as `UNKNOWN_FILE`. It reports:

| Code | Severity | When | `--fix` |
| --- | --- | --- | --- |
| `TRANSACTION_PENDING` | error | A prepared transaction could not be rolled forward. Its message names the operation, the transaction id, the pending paths and the recovery error. | Retries recovery under the lock. On success it reports the operation as finished. |
| `TRANSACTION_LEFTOVER` | warning | An unprepared or complete transaction folder could not be removed during recovery. | Removes the folder. |
| `TEMP_FILE_LEFTOVER` | warning | A leftover `.<name>.<8 hex>.tmp` from an atomic write, or a `.<8 hex>.moving` folder from the old move code, anywhere in the Data Root. | Removes it. A `.moving` folder that holds a `story.json` is reported but not removed: the finding names the Story Key inside and asks the person to move it back. |
| `GITIGNORE_INCOMPLETE` | info | The Data Root's `.gitignore` lacks one of `local.json`, `.lock`, `.lock.break` or `.txn/`. | Appends the missing lines, keeping the rest. |

A stale `.lock` is not a finding. The next acquisition breaks it under the rule in §1.

## 10. Symlink policy

Rowbly assumes a **trusted filesystem**.

- A symlinked Data Root (for example `.rowbly` → elsewhere) is allowed. It is canonicalized with `realpath` once, and all containment checks use the canonical path.
- Inside a Plugin scope, a symlink is **rejected** for read, write, list and delete. A Plugin scope is the `plugins/<id>/` folder itself, every folder beneath it on the way to a file, and the final file. Storage resolves the physical scope folder once per call. It checks each existing component with `lstat`, and throws `ValidationError`: `Plugin "<id>" file <name> is reached through a symbolic link, which Rowbly does not follow`. `list` reports neither linked entries nor what lies behind them. Relative-name checks (no `.`/`..`, no absolute paths) stay in place.
- Record folders (`boards/<id>/`, `stories/<KEY>/`) are not checked for links. Moving or deleting a linked record folder moves or deletes the link itself (rename semantics), never its target.
- These checks are check-then-use. They catch accidental links. They are **not** race-proof against someone who swaps links concurrently, and Rowbly does not claim confinement against malicious code (ADR-0020 §6).

## 11. Guarantees

| Phase | Guarantee |
| --- | --- |
| Before commit: a body, hook or validation rejects | Nothing is written, and no reaction runs. |
| Commit, then an I/O failure or process death | After recovery, the complete old state or the complete new state. Recovery is idempotent and safe to run again if it is interrupted. |
| Concurrent cooperating operations (other processes or service instances) | Serialized by the lock. No accepted change is silently lost. Story Keys are distinct. |
| Participating readers | Never see a half-applied commit. |
| External tools (editors, Git, `cat`) | May see intermediate files. They are outside the lock protocol. Documented. |

This ADR adds coordination and a journal to ADR-0012's single save. It does not change the pipeline order. ADR-0013's statement that renumbering moves only `story.json` no longer holds: the whole Story folder moves, as §4 describes.
