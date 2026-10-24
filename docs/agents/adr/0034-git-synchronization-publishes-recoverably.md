# ADR-0034: Git synchronization prepares isolated merges and publishes recoverably

**Status:** Accepted (ROW-15; implementation in progress)

## Context

Automatic synchronization crosses the Data Root, Git ref, working files and index. A live merge or a
HEAD-only journal cannot protect cooperating reads from a partially installed result. The existing
Automatic Commits preference must remain independent.

## Decision

### 1. Scope and lifetime

Automatic Merge Conflict Resolution is Off by default, with a separate local interval (1–86400
seconds, default 300). It fetches the configured upstream and prepares a merge of that exact branch;
this is the pull/merge sequence, without rebasing. Runs are noninteractive, coalesced and bounded.
Latest saved preferences govern admission. An admitted run may finish, including push, after Off.
Persisted fixed-delay deadlines survive restart; one overdue attempt resumes while Rowbly is open.
There is no daemon. Host replacement, root switching and shutdown dispose future scheduling.

### 2. Deterministic reconciliation and evidence

Reconcile BASE and both source snapshots, including textually clean JSON merges. Missing differs
from null. Independent fields and non-overlapping text hunks combine. Concurrent leaf or overlapping
hunk alternatives use stable content/source ordering, with both exact alternatives, base, provenance,
deletion intent and repairs retained in committed content-addressed Git Plugin evidence. Failure to
retain evidence blocks publication. Edit wins over delete, including edited descendants.

Distinct concurrent additions retain complete subtrees, even with equal timestamps. Exact identical
additions coalesce. Renumbering uses source-qualified Board/Story maps; ordinary CRUD identities stay
immutable. Configuration Cascade levels remain separate. Restore referenced definitions, split
incompatible field types and relax constraints only to retain valid data, recording original values.
Do not use unrestricted doctor fixes that strip data.

### 3. Format ownership

A registered Plugin may supply one pure reconciliation callback for its own supported raw bags and
scoped files, core source-qualified identity maps and narrow deterministic helpers. The host checks
output ownership and validity. No services, Git or filesystem effects are provided. The callback may
run while the Plugin is Off; ordinary hooks, commands and start remain Off. Unsupported, invalid,
unknown or future data stays opaque, with exact alternatives retained. This is no migration API or
generic merge policy language. Core contains no Plugin-specific format rules.

### 4. Lock order

Workers share a canonical common-Git-directory lock across Data Roots, processes and worktrees.
A short publication gate precedes each participating Data Root lock. Worker order is worker lock,
publication gate, then canonical sorted Data Roots. Never acquire a worker lock while holding a gate
or Data Root lock. Never run a Git subprocess under a Data Root lock. Fetch, merge and push stay
outside the publication gate. Capture drift requires recomputation rather than overwriting a save.
Pending acknowledgements cannot clear a later revision, including another edit to the same path.

### 5. Local publication and recovery

Before durable intent, live HEAD, index and files are unchanged. Prepare the candidate separately.
Revalidate expected ref, index fingerprint, branch/upstream and every overwritten path; carry forward
unrelated staged entries and reserve the real index.lock with exclusive ownership. Persist all old
and new payloads/modes, candidate reachability, expected OIDs and phase before local effects. Use
expected-ref compare-and-swap, recoverable root transactions, idempotent working-file application and
atomic carried-forward index replacement. The candidate need not descend from the old local tip.

After intent, local recovery finishes one complete valid result before any cooperating read/write,
even when synchronization is Off. Recovery performs no network work and does not authorize a push.
Recognize effects that landed before their phase write. Never overwrite unexpected external edits,
remove another process's locks or force a ref. Preserve diagnostic evidence on unrecoverable I/O.
External Git/editors remain outside cooperative locking.

### 6. Upstream and failure

Push the validated installed candidate only to the recorded configured remote/ref with a normal
refspec; it must descend from the fetched remote tip. Push rejection or a lost response leaves the
valid local merge intact; the next enabled attempt fetches and reconciles again. Non-Rowbly conflicts,
unsafe topology, staged Rowbly ambiguity, invalid input, detached HEAD, missing upstream and bounded
network/authentication failures stop safely. Preserve unrelated staged, dirty and untracked content.
No stash, reset-hard, force-push, whole-repository commit or automatic branching/hook installation.

## Consequences and amendments

This narrowly extends ADR-0016 and ADR-0026 beyond commits; ADR-0030 gains the common worker lock and
short publication gate while retaining its no-Git-under-root-lock rule. ADR-0019 gains host-owned Git
import publication and private source-qualified renumbering. ADR-0011, ADR-0020 and ADR-0021 permit
only the pure supported-format callback during import; ordinary opaque-bag preservation and format
compatibility remain. ADR-0003's collision test uses base/source provenance, never timestamp inequality
alone. No UUID, migration framework or merge/rebase strategy setting is introduced. ROW-17 owns rebase.
