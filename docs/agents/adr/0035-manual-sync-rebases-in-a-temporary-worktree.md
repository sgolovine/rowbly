# ADR-0035: Manual Sync rebases in isolation and never force-pushes

**Status:** Accepted. Built (ROW-17). Amends ADR-0034 §1, §5–6 for explicit manual Sync and ADR-0017's Action boundary. Keeps ADR-0030's no-Git-under-Data-Root-lock rule.

## Context

The Git Plugin contributes a header **Sync** Action (`S`) whenever enabled. A manual request must
commit pending Rowbly changes before network work, even with Automatic Commits and Automatic Merge
Conflict Resolution Off. Scheduled synchronization and the existing `git sync` command retain their
merge semantics. The manual request must await its own pushed result, including when a scheduled
merge is already running.

## Decision

### 1. Commit, fetch, replay, publish, push

`PluginGit.requestSync(liveResolver, 'rebase')` uses the shared synchronization service and common
Git worker. Before fetching, it captures valid pending Rowbly data/configuration additions, edits
and deletions through an alternate index and publishes a nonempty capture commit using ADR-0034's
recoverable publication engine. No empty capture commit is created. Fetch/push still run with no
pending changes. Local State, locks and transactions remain excluded. Already-staged Rowbly changes
remain an explicit ambiguity error; unrelated staged entries and working/untracked files survive.

Fetch the configured upstream into a private pinned ref. Replay linear local commits in order onto
that exact upstream using isolated `merge-tree --merge-base=<original-parent>` and alternate-index
plumbing. For every replay, run ROW-15's pure reconciliation on the original parent, replayed tip and
original commit, even for textually clean JSON merges. Validate each candidate and retain conflict
alternatives, identities, remaps and committed evidence. Preserve original author identity/date and
message. Original empty commits are retained; no extra empty capture commit is created.

When divergent history contains a local merge commit, refuse before replay publication with guidance
to use `git rebase --rebase-merges`, then retry Sync. Never silently flatten or drop merge topology.
Replay is bounded to 512 commits and the existing run/process/output limits. Non-Rowbly conflicts
require manual Git resolution. The pre-fetch capture remains recoverable on every later failure.

### 2. One recoverable publication path

Both the pre-fetch capture and final replay result use ADR-0034 §4–5: common worker, publication gate,
short Data Root capture/transaction locks, expected-ref CAS, carried-forward reserved index, durable
payload journal and local recovery before cooperating reads/writes. Capture drift recomputes the
candidate; a later save is never overwritten or acknowledged as an earlier revision. No Git process
runs under a Data Root lock. There is no separate landing marker, live checkout rebase, stash or
accepted save-overwrite window. External Git/editors remain outside cooperative locking.

Push normally to the configured remote/ref only after validated local publication. A push failure
leaves local commits available for retry and never causes force-push or rollback of saved work.

### 3. Admission and completion

A manual rebase is independent of both automatic preferences, but requires the Git Plugin enabled.
A scheduled merge already running completes first; the manual request then admits a distinct rebase.
Overlapping manual requests join the same rebase. The shared worker serializes Automatic Commits,
scheduled synchronization and manual Sync across processes/worktrees. Admission checks the current
branch/upstream. An admitted run may finish after preferences change; host disposal stops future work.

Manual completion returns the exact joined run's identity/result and throws on failure. It never
reports success from stale persisted `last` data or from another mode's completion.

### 4. Action boundary and feedback

This narrowly amends ADR-0017: an Action may request host-owned Git synchronization without a new
matching command, including the validated Rowbly import it publishes. It does not gain arbitrary
filesystem or Git execution. `S` shows `Sync…` while pending; a synchronous guard ignores duplicate
keys/clicks before a render. Progress phases are persisted for inspection. Only a completed normal
push produces the success toast. Failure toasts include the cause and recovery guidance.

The existing `rowbly git sync` command remains an immediate enabled **merge** request. The header is
the explicit rebase surface. No new CLI command or strategy preference is introduced.
