# ADR-0035: Manual Sync rebases before capturing pending data

**Status:** Accepted (ROW-17); private replay mechanism proven, feature implementation in progress.

## Context

The Git Plugin needs an explicit Sync independent of Automatic Commits and Automatic Merge Conflict
Resolution. A rebase rewrites unpublished commits and can omit merge nodes, so a final-tip merge cannot
implement the requested sequence or preserve identity continuation and merge-only changes.

## Decision

### 1. Manual intent and surfaces

Git contributes the generic S/Sync Action whenever enabled, with `git sync --rebase` as its command
counterpart. Neither changes a preference. This amends ADR-0017: an Action may change data when the same
change is available through a Plugin command. Existing bare `git sync` and automatic scheduling keep
ADR-0034 merge behavior. Generic Action status and a synchronous pending guard share the same busy
predicate for keyboard, mouse and hints. Status uses a private read-only `status` invocation stage,
excluded from Operation starts, Change Set writes and all Git scheduling/request admission. Full
context reads remain available. Existing editable `field` callbacks retain their write boundary.
Git status performs only host-local recovery and configuration reads, outside Data Root coordination
for Git processes; polling never schedules work. Progress remains visible at compact widths. Late results from
an obsolete Data Root or host cannot toast in a new session.

### 2. Isolated replay and ownership

Run literal `git pull --rebase` in an owned standalone Git context before staging or committing pending
Rowbly bytes. A fixed private strategy and bounded parent IPC bridge prepare each replay tree from its
exact original parent, rebased preimage and original source. Git creates replay commits. Isolate user
refs, updateRefs, autostash, rerere, hooks, drivers, filters and attributes; project usable noninteractive
transport and author settings deliberately. Never expose arbitrary execution or strategy selection to
Plugins. Detect Git fast paths and validate their correspondence rather than assuming the strategy ran.

Carry source-qualified core and owner identity maps through both BASE and each replayed source, then
through pending bytes. The existing pure reconciliation callback alone owns its supported identifiers
and references. Its optional replay input and identity output are scoped to that owner, validated and
bounded by the host. Check raw recognized identities before projection or opaque fallback. Unknown and
future formats retain exact opaque preservation and evidence. No new stored identity or migration
framework is introduced.

Core records Custom Field aliases at the exact incompatible-type split, qualified by source and
definition scope. Private replay projection carries those aliases through BASE, successive commits
and pending values. Project definitions and effective Story values simultaneously, respecting root
inheritance, Board overrides and Board identity changes. A new raw key at an earlier alias destination
refuses before publication when correspondence is ambiguous. These private core maps do not expand
the Plugin API or authorize interpreting Plugin identifiers.

Replay alone may return `removedFiles`, at most 4096 unique normalized exact relative own paths
present in a supplied own snapshot. The host rejects non-arrays, non-strings, unsafe paths, other
scopes, duplicate entries and simultaneous add/remove of one path before changing the immutable
candidate. Empty/absent removals preserve ordinary merge behavior; nonempty removals without replay
are refused. Owners remove only recognized moved paths absent from their final projected snapshot.
Opaque/future/invalid bytes and modes remain exact; binary Markdown cannot be transported as text.
A surviving identity at an old path is returned explicitly rather than removed. No live file or
append-only Merge Evidence deletion is authorized. Allocation uses stable code-unit ordering.

### 3. Merge effects and pending work

Inventory unpublished two-parent merges, recompute their original-parent reconciliation baseline and
retain committed resolution effects with exact provenance. Apply each omitted merge's Rowbly effects
once at its replay frontier before a dependent descendant, or after pull when it is final. Normal
ROW-15 merges after rejected pushes are supported. Ambiguous bases, octopus merges, non-Rowbly
resolution-only effects and unprovable skipped correspondence refuse before live effects.

After pull and merge overlays, transport the old-tip-to-working capture through the same identities,
reconcile and stage eligible Rowbly files only. Add a final commit only when its tree changes. Preserve
private exclusions, unrelated staging, dirty/untracked bytes, modes and later pending revisions.

### 4. Admission, publication and completion

Use the existing canonical worker, live admission, jobs and drains. One coalesced manual id has its own
terminal receipt; an automatic merge or an older successful result cannot fulfill it. Keep receipts for
at least 15 minutes, beyond the five-minute waiter deadline; report a missing result as unknown.
Only the requesting process can admit pending manual intent; other processes join its receipt. Git Off cancels
unadmitted work; admitted work may finish. Automatic preferences govern only automatic work. Restart
does not replay a manual network request, and an unknown push response is never historical success.

Keep ADR-0034's journal protocol and recovery. The candidate need not descend from the old local tip,
but must descend from the exact fetched upstream before normal push. Success follows that request's
acknowledged push. Push failure retains the valid local result and evidence with an actionable cause.
Recovery finishes local intent without network even while Off. No force push, stash, reset-hard,
whole-repository staging or new strategy preference is permitted.

## Consequences

The private strategy, real Git fast paths, owner continuation and a genuine rejected-push ROW-15 merge
must be proven before publication is enabled. Failure or a broader topology limit requires revised
acceptance. ADR-0034 automatic merge behavior and its existing storage guarantees remain in force.
