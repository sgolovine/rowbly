# ADR-0046: Verified workers use metadata bound to the current Stage Run

**Status:** Accepted; amends ADR-0040 §2

## 1. Context

A supervisor can start a Stage Run before it knows the launched worker's real identity. A title is
not enough to find a thread after restart, especially when the thread belongs to another machine.
New fields in the legacy Stage Run bag would be silently dropped by older owning writers
(Plugin compatibility policy §3.4). Identity, model selection and observed activity need one
current-Run representation without adding core fields or retaining Run history.

## 2. Decision

Keep the legacy Stage Run bag unchanged. Software Factory owns the Story file
`plugins/software-factory/run-metadata.json`, a strict version 1 object:

- `run: { stage, attempt, startedAt }` binds the file to one Run.
- Optional `identity: { worker, machine, harness, threadId, verification: { source, verifiedAt, by } }`
  records the supervisor's attestation of the actual launched worker. Rowbly does not contact the
  harness. `worker` agrees with the Stage Run's worker; machine and harness say where to resolve
  `threadId`, never implicitly on the supervisor's machine.
- Optional `selection: { provider, model, options: [{ id, value }], rule, fallback, usage,
  selectedBy, selectedAt }` holds exact provider instance/model IDs, model options, policy rule and
  fallback reason or null. `value` is a string, number or boolean; `usage` is `unknown`,
  `observed-limit` or `user-stated`. No quota is invented. Selection is independent of identity,
  so a failed launch may retain its selection without an attached worker.
- Optional `heartbeat: { worker, at, source, by }` holds supervisor-attested observed activity.
  It requires an identity with the same worker. Age alone never clears, retries or ends a Run.
- `by` and `selectedBy` come from Me, or null. Timestamps come from the operation clock.

The shared schema supports all three sections. Selection mutations/policy and heartbeat operations
are separate changes; this decision does not claim those commands are already built.

`software-factory.attach` checks the expected Run reference against the current running Run under
its operation lock, initializes absent or positively recognized stale v1 metadata, updates the
legacy worker string and records identity in one Change Set. A final guard checks the pending Run,
reference and identity after all transforms. A conflicting identity replacement is refused;
identical inputs (including attestation source and Me) write nothing and retain the original
verification time. Same-Run writes preserve the other sections' JSON values.

Every successful start, including a retry or a start without selection, writes a fresh empty
envelope before any new sections. Clear and Stage changes remove positively recognized v1 metadata
alongside the Run. These explicit lifecycle writes prevent an old identity or heartbeat from
returning when a frozen clock repeats stage, attempt and startedAt. Finish and fail retain metadata
for recovery until clear, retry or a Stage change. A stale reference never supplies current output.

Unknown fields, unsupported versions and unreadable bytes are kept unchanged and shown as
unavailable. Doctor reports them without a fix; owning writes that need metadata refuse with
DATA_INTEGRITY. Clear and Stage changes may end the legacy Run while preserving opaque metadata.
New starts refuse it rather than silently removing it. Older releases keep the separate file when
rewriting the legacy bag. Supervisors using verified recovery must use the new lifecycle commands;
older releases do not maintain or attest this metadata.

The supervisor reserves or launches a worker that waits for GO, verifies its actual machine,
harness and thread identity from the launch result, attaches it, publishes the Board and only then
sends GO. A confirmed failed launch ends the Run with its reason. An ambiguous launch, unreachable
machine or failed attachment/publication requires reconciliation: do not release an unrecorded
worker or create a duplicate. On restart, resolve verified identity on its recorded machine;
legacy worker strings are hints requiring independent verification. Preserve retry evidence before
replacing the Run. One supervisor per Board remains required; this is not a distributed lock.

## 3. Rejected alternatives

- More optional legacy bag fields: older owning writers could erase recovery evidence.
- A version key alone in the bag: older schemas drop it instead of refusing the shape.
- Run history or migration machinery: current-visit recovery needs neither.
- Timestamp uniqueness as the lifecycle boundary: clocks can repeat, so start/reset explicitly
  invalidates recognized metadata even when the complete reference repeats.
- Treating a title or a locally unresolved remote thread as proof of absence: both can launch
  duplicate work after a supervisor restart.
