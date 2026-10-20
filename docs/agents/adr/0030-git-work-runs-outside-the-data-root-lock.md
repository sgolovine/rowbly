# ADR-0030: Git work runs in a queue outside the Data Root lock

**Status:** Accepted. Implements the maintainer's request to queue Git work without blocking the UI; amends ADR-0026 §2 and clarifies §1 and §4.

Git reactions previously held the Data Root lock across several subprocesses, each with a 3.5 s limit, while a reaction had a total 5 s deadline. Timing out the reaction did not stop that work. A background reaction could also reacquire its saving caller's inherited hold after cleanup, leaving the lock unreleased. The resulting reads and writes failed with `CONFLICT` while the same process remained alive.

**§1 Queue ownership.** Reactions run in an independent coordination context. Git effect promises resolve after persisting the queue update. A worker serializes Git work under a separate lock in the worktree's Git `rowbly/` directory, shared by Data Roots using that index. Queue updates and worker acknowledgements hold the Data Root lock briefly; Git subprocesses never hold it. Command-mode Operations and the CLI await due queue work outside reaction deadlines. The TUI returns after enqueueing. Rapid edits may be batched into one Automatic Commit.

**§2 Consistent files.** The worker selects affected paths with Git, then copies those files under the Data Root lock after recovery. It releases that lock before running Git against the immutable copy. Commits retain ADR-0026 §3's path, staging, author, hooks and signing rules. A pending revision increments on every enqueue; success clears only the revision it processed. A later edit to the same path remains queued. Older pending files without revisions remain readable.

**§3 Lifetime and failure.** Pending paths, deadlines and preferences persist as before. A failure warns and retains pending work. Disabling Git pauses waiting jobs; an already running commit may finish. Interval timers remain unreferenced, with no daemon and no flush of future deadlines. Existing per-process Git time/output limits remain in force. External Git and editors remain outside Rowbly's coordination guarantee.

We rejected running Git against live files after merely releasing the Data Root lock: it could capture a transaction partway through applying. Keeping Git processes under that lock, increasing the reaction deadline, or only putting reactions in the background would leave reads and edits blocked by slow Git work.
