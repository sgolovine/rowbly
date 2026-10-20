# Storage and commits

How Rowbly reads and saves the Data Root safely when several Rowbly processes share it. The full contract, with every step and recovery rule, is [ADR-0019](../agents/adr/0019-coordinated-recoverable-commits.md); this page summarizes it. The code is in `src/storage/` (`lock.ts`, `transaction.ts`, `io.ts`, `pathPolicy.ts`) and `src/services/coordination.ts`.

## Guarantees

| Situation | Guarantee |
| --- | --- |
| A body, hook or final check fails or refuses before the save | Nothing is written and no reaction runs. |
| The save, then an I/O failure or the process dies | After recovery, the whole old state or the whole new state of the operation. Recovery is safe to repeat. |
| Concurrent Rowbly operations, in any processes | They run one after another under the Data Root lock; each plans from the latest saved records. No accepted change is lost, and Story Keys stay distinct. |
| Rowbly's own reads | Never see half a commit. |
| Editors, git, `cat`, scripts | Do not take the lock and may see intermediate files. Rowbly detects what it can (conflict markers, schema failures, identity checks, leftovers that doctor reports) but does not protect against them. |

The guarantee covers the Rowbly process dying (a crash, `kill -9`, Ctrl-C). It does not cover power loss or storage that loses acknowledged writes; Rowbly fsyncs on a best-effort basis.

## The lock

- **One lock per Data Root**: `.rowbly/.lock`, created with exclusive create and holding the owner's pid, host, start time and a random token. The Data Root path is canonicalized with `realpath`, so every alias of one Data Root shares one lock.
- **Every service call takes it**, reads included, before its first read. An operation holds it through its body, hooks, final checks and commit, and releases it before its reactions. Inside one process, waiters queue in order.
- **Waiting.** A busy Data Root is retried with backoff for up to 10 s, then fails with `CONFLICT` (exit 4) naming the holder.
- **Stale locks** are broken: a lock whose process is gone on this host, or older than 10 minutes. Breaking takes a second lock, `.lock.break`, so two waiters never both break one lock. An operation never waits for a person while it holds the lock: prompts and editors run before it.
- **Reentrancy.** Reads inside an operation reuse its lock. Starting a change from inside an operation is refused before it reaches the lock.
- **Reactions own their reads.** They run with an independent coordination context, so a background read cannot reacquire the saving caller's lock after that caller has already finished releasing it.

## The commit journal

Each save is one transaction in `.rowbly/.txn/<id>/`:

1. **Validate** the whole final plan: record schemas, parents, the stored sources of updates, moves and deletions, free destinations, unique keys, path containment, one filesystem, the symlink policy, and that no Plugin changed an `enabled` value. A failure throws before anything is written.
2. **Stage** each new file in `staged/`, fsynced.
3. **Prepare**: write `manifest.json` with `phase: "prepared"`. This is the commit point.
4. **Apply**: move renumbered Story folders out, delete, move them in, then write each staged file over its destination.
5. **Complete**: mark the manifest `complete` and remove the transaction folder.

**Recovery** runs at every lock acquisition, before anyone reads: a transaction without a manifest is removed (nothing live changed); a prepared one is rolled forward step by step; a complete one is removed. If an apply fails in the running process, it retries once; if that fails, the operation throws `DATA_INTEGRITY` (exit 6), and the next Rowbly command finishes it.

**Single files** outside a transaction (for example `rowbly init`) are written to a temporary `.<name>.<hex>.tmp` file in the same folder and renamed over the destination, so a failed write never truncates a file.

## File scopes and symlinks

- A pending Plugin file is stored by its scope (the Data Root, a Board or a Story) and name, not by a path. Its path is resolved at commit, so a file follows a Story that doctor renumbers in the same plan.
- Writing a file in a Board or Story that the same operation deletes fails with `CONFLICT`; reading it gives nothing.
- A Story's key and Board never change through an ordinary update. Only doctor's renumbering changes a key.
- Rowbly assumes a trusted filesystem. A symlinked Data Root is allowed. A symbolic link inside a `plugins/<id>/` folder is refused for every read, write, list and delete. These checks catch accidental links; they are not race-proof against someone swapping links.

## Local State

Context changes (`use`, `whoami`) start from the stored Local State, read under the lock. After a save, the saved Local State becomes the running context's before the reactions run; Me changes only when the stored Me changed.

## Leftovers that doctor reports

| Code | Meaning | `--fix` |
| --- | --- | --- |
| `TRANSACTION_PENDING` | A prepared commit that recovery could not finish | Retries recovery |
| `TRANSACTION_LEFTOVER` | A transaction folder that could not be removed | Removes it |
| `TEMP_FILE_LEFTOVER` | A temporary file of an interrupted write, or a `.moving` folder from an older Rowbly | Removes a temporary file; a `.moving` folder is only reported |
| `GITIGNORE_INCOMPLETE` | The Data Root `.gitignore` lacks `local.json`, `.lock`, `.lock.break` or `.txn/` | Adds the missing lines |

A stale `.lock` is not a finding: the next acquisition breaks it.

## Git Automatic Commits

The optional Git capability persists pending paths/deadlines under Git's own directory. Queue updates and a copy of selected saved files take brief Data Root locks with recovery. All Git subprocesses run outside that lock, using the immutable copy as their working tree. A separate lock in the worktree's Git `rowbly/` directory serializes workers, including workers for different Data Roots sharing an index. Each enqueue increments a pending revision; a successful commit acknowledges only its revision, so later edits to the same paths remain pending. Legacy pending files without a revision resume normally. A Git failure leaves the Rowbly save intact and retains pending work.

Only affected record/file paths are selected, never `local.json`, `.lock` or `.txn/`. The TUI returns after enqueueing, and command mode drains due work outside reaction deadlines. External Git and editors do not participate in either Rowbly lock; Git's own index lock still protects its index. See [Git](../plugins/built-in.md#git) and [ADR-0030](../agents/adr/0030-git-work-runs-outside-the-data-root-lock.md).
