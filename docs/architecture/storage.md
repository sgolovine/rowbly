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

## Watching for changes

The TUI watches its open Data Root (`watchDataRoot` in `src/storage/watch.ts`) and reloads what is on screen when a file under it is created, changed, deleted or renamed, by any process. It watches each folder, adding folders as they are created, rather than using `fs.watch`'s `recursive`: on Linux that watches each file by its inode, and an atomic write replaces the inode, so the next write to the same file went unseen. It ignores the lock files at the top of the Data Root, the commit journal under `.txn/` and the temporary file of an atomic write: every service call takes the lock, reads included, so reporting it would make each reload report another change. The reload reads under the lock like any other call, so it sees a committed state, never a commit half applied. A burst of events, such as one command's several files, is reported once, 100 ms after the last. A watcher that fails warns once, starts again every 2 s, and reports a change when it does, since nothing watched in between. Switching to another Data Root or quitting closes it.

## Local State

Context changes (`use`, `whoami --local`) start from the stored Local State, read under the lock. After a save, the saved Local State becomes the running context's before the reactions run; Me changes only when the stored local Me changed, and a cleared local Me falls back to global Me, reread just before the change ([ADR-0032](../agents/adr/0032-me-is-global-with-a-local-me-per-data-root.md)). `whoami` without `--local` changes the Home Config instead.

## Home Config

`~/.rowblyrc.json` ([ADR-0031](../agents/adr/0031-per-user-settings-live-in-a-home-config.md), `src/storage/homeConfig.ts`) is outside every Data Root, so it has its own lock.

- **Created without replacing.** Start-up writes `{ "version": 1 }` to a temporary file beside it and hard-links it into place only if the name is free, so it never overwrites a file, even one another process creates at the same moment. Creating it is best effort.
- **Changed under a lock.** `updateHomeConfig` takes `~/.rowblyrc.json.lock` (the Data Root lock's code with another file name, and `~/.rowblyrc.json.lock.break` to break a stale one), rereads the file, applies the change and replaces the file atomically. Concurrent Rowbly processes therefore never lose each other's changes. An unchanged result is not written.
- **Links and permissions.** A symlinked Home Config is replaced at its target, so the link stays. The new file keeps the old one's permissions; a new file gets the default permissions of the umask.
- **A home folder Rowbly may not use.** Start-up creation ignores the failure. `readHomeConfig` and `updateHomeConfig` turn a refused, read-only or missing path into `USAGE` (exit 2) naming the file and its folder.
- **Several defaults are reported, not repaired.** Doctor reads the Home Config and reports more than one `dataRoots` entry marked `default` as `MULTIPLE_DEFAULT_DATA_ROOTS`; `--fix` leaves the file unchanged.
- **Never replaced when unreadable.** Invalid JSON, a schema failure, conflict markers, a folder or a link to a missing file throws `DATA_INTEGRITY` naming the file and leaves it as it is.

## Leftovers that doctor reports

| Code | Meaning | `--fix` |
| --- | --- | --- |
| `TRANSACTION_PENDING` | A prepared commit that recovery could not finish | Retries recovery |
| `TRANSACTION_LEFTOVER` | A transaction folder that could not be removed | Removes it |
| `TEMP_FILE_LEFTOVER` | A temporary file of an interrupted write, or a `.moving` folder from an older Rowbly | Removes a temporary file; a `.moving` folder is only reported |
| `GITIGNORE_INCOMPLETE` | The Data Root `.gitignore` lacks `local.json`, `.lock`, `.lock.break` or `.txn/` | Adds the missing lines |

A stale `.lock` is not a finding: the next acquisition breaks it.

## Git Automatic Commits

The optional Git capability persists pending paths/deadlines under Git's own directory. Queue updates and a copy of selected saved files take brief Data Root locks with recovery. All Git subprocesses run outside that lock, using the immutable copy as their working tree. A separate lock in the canonical common Git directory's `rowbly/worker/` folder serializes workers across Data Roots, processes and linked worktrees. Each enqueue increments a pending revision; a successful commit acknowledges only its revision, so later edits to the same paths remain pending. Legacy pending files without a revision resume normally. A Git failure leaves the Rowbly save intact and retains pending work.

The optional `automaticCommits` option defaults to `true` when absent in legacy pending files. When false, queue updates still retain and add paths, but cancel timers and start no work. Plain-option capability callers keep using persisted pending options. Built-in Git supplies a live resolver: scheduling and worker admission read its current Local State bag under the Data Root lock and resolve preferences there. When worker admission finds changed preferences before their reaction runs, it persists the new options, adjusts the deadline for the interval difference and increments the revision together before deciding whether to pause. Delayed startup, reactions and stale timer callbacks therefore cannot bypass a saved Off preference. Scheduling and timer decisions take the Data Root lock together with pending updates. Turning Automatic Commits back on preserves the first-write deadline (adjusted by interval edits); an overdue interval runs immediately. A job admitted under the Data Root lock is running and may finish; acknowledgement cannot discard later paused revisions.

Only affected record/file paths are selected, never `local.json`, `.lock` or `.txn/`. The TUI returns after enqueueing, and command mode drains due work outside reaction deadlines. External Git and editors do not participate in either Rowbly lock; Git's own index lock still protects its index. See [Git](../plugins/built-in.md#git) and [ADR-0030](../agents/adr/0030-git-work-runs-outside-the-data-root-lock.md).

## Recoverable Git publication

The local publication engine implements ADR-0034 §4–5. Synchronization prepares an isolated
upstream merge and uses this engine before a normal push. All cooperating service calls acquire the common Git publication
gate before their Data Root lock, and release both before reactions. Git location discovery and every
Git child run outside Data Root locks. A worker takes the common worker lock before the gate.

A detached candidate supplies an expected branch ref/OID, before/after index bytes and exact changed
working-file bytes/modes. Publication rechecks the index and each changed path, stages existing
Data Root transactions (including binary Plugin files and executable modes), reserves the real
`index.lock` exclusively with a random ownership token, pins the candidate, then atomically persists
`rowbly/publication.json` under the common Git directory. This durable intent precedes local effects.
Unrelated staged entries are carried forward in the prepared index; no live whole-tree index is read
from the candidate. No network operation belongs inside this gate.

Recovery uses expected-ref compare-and-swap, the Data Root transaction journals, idempotent clean
working-file installation and atomic index replacement. It recognizes ref/index effects that landed
before their phase write. It runs before the next cooperating read, through any linked worktree,
including while synchronization is Off. It performs no fetch or push. Pre-intent payloads are
disposable; prepared payloads roll forward. A pre-application ref refusal discards only owned staging
and reservation. Unexpected external index/path/ref changes after effects preserve the journal and
stop recovery instead of overwriting external work. Only a token-owned index reservation is removed.

`test/storage/transaction.test.ts` injects failures at every filesystem boundary and kills a real
process after the ref effect but before its phase write. It checks complete local recovery, binary
bytes/modes, unrelated staged blobs/working bytes and recovery through a second linked worktree.

Synchronization captures all valid dirty Rowbly files even while Automatic Commits is Off. It uses an
alternate index, `merge-tree --write-tree` and the real base/sides, then validates supported core and
Plugin formats. Non-Rowbly conflicts, staged Rowbly ambiguity, unsupported topology, or overwriting
unrelated dirty/staged/untracked paths stop preparation without live effects. Captured root drift
retries preparation at most three times. Rejected/lost-response pushes retain the valid local result;
a later attempt fetches the configured upstream again. Candidate indexes and fetch pins are cleaned
on completion. Local Git children have 3.5 s limits, merge calculation 10 s, network commands 30 s,
output 16 MiB and the overall run 120 s; Unix process groups are killed and awaited on timeout.
The reconciled candidate, including retained evidence, must fit the same 4096-file/64 MiB Data Root
bound as capture before publication; an oversized candidate leaves live data, ref and index intact.

Synchronization deadlines/results live separately under the worktree Git directory. The feature is
Off by default. Saved preferences govern worker admission; timer/button/process bursts coalesce.
Deadlines also retain the exact branch/upstream identity. A stale timer after a branch or upstream
change records a failed attempt without fetching; the next full interval uses the newly observed
target. Explicit requests and new scheduling bind the current target, which is checked again before
fetch and publication.
Fixed-delay deadlines persist across restarts, including failures, with one overdue attempt and no
catch-up burst. A failure before admission records a failed attempt when recovery and locking permit,
then retries from the latest interval; unavailable local recovery uses a 30 s wake-up that rechecks
saved preferences before admission. A disposed host cannot replace the current host's scheduling lease
after an awaited setup. An admitted run may finish after Off. Private host leases cancel future timers on
replacement, failure, root switch and shutdown. Metadata changes never queue Rowbly commits.
Each new synchronization worker removes abandoned private candidate indexes and fetched pins under
the common worker lock; prepared publication pins belong to journal recovery and are kept until it completes.
