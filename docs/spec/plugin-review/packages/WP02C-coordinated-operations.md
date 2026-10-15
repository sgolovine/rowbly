# WP02C — Coordinated operations, recovery integration & freshness

**Depends on:** WP02A, WP01B · **Wave:** 3 · **Priority:** P0 · **Critical path:** yes
**Review sources:** [README WP02](../../../reviews/plugin-architecture/README.md#wp02); [RES-01](../../../reviews/plugin-architecture/resiliency.md#res-01), [RES-02](../../../reviews/plugin-architecture/resiliency.md#res-02), [RES-07](../../../reviews/plugin-architecture/resiliency.md#res-07), [RES-19](../../../reviews/plugin-architecture/resiliency.md#res-19); [ARCH-37](../../../reviews/plugin-architecture/general-architecture.md#arch-37), [ARCH-41](../../../reviews/plugin-architecture/general-architecture.md#arch-41).

## Goal

Make concurrent and crashed operations safe from end to end:

- every mutating operation runs under the Data Root coordinator from its first state read through commit;
- recovery runs before repository access;
- stale in-memory context never overwrites newer stored state;
- Story-key allocation never adopts orphan folders;
- the prefix cache stays consistent with external Board changes.

This package closes RES-01 and ARCH-41 end to end.

## Owns

- `src/services/index.ts`: wire the coordinator into service construction through WP01A's `enter`/`exit` seam
- `src/services/plugins/runtime.ts`: lock-boundary and context-synchronization edits only
- `src/services/context.ts`, `src/services/boards.ts`, `src/services/stories.ts`, `src/services/tasks.ts`, and the other mutating services: the stale-read and stale-context audit only
- `src/storage/repositories.ts`: allocation reservation and the prefix cache
- `src/storage/dataRoot.ts`: running recovery on open
- new tests: `test/plugins/concurrency.test.ts`, `test/plugins/orphanFolders.test.ts` (the allocation part), `test/storage/repositoryFreshness.test.ts`, `test/plugins/localStateFreshness.test.ts`, and the subprocess-kill part of `test/plugins/transactionFailure.test.ts`

## Must not touch

`src/services/doctor.ts`. WP03 moves doctor analysis inside the coordination, using the API you expose.

## Deliverables

1. **Coordination (D1, RES-02).**
   - Acquire the lock from WP02B **before** an operation reads any state used for planning, and hold it through validation, commit, and recovery. Release it before reactions.
   - This covers core mutations, plugin operations, configuration changes, Local State changes, and setup/init where applicable.
   - Expose `withMutation(root, fn)`, or an equivalent, for doctor (WP03).
   - Reuse the held context for reads inside the operation. Nested mutations are already rejected by WP01A, so the lock is never re-entered.
   - Audit every read that happens before `ops.run`. Audit every place that copies `ctx.local` or another in-memory snapshot into a write.
2. **Recovery (D2, RES-01, ARCH-41).** Opening a Data Root for repository access runs `recover` under the lock before any read. Interrupted transactions reserve their Story keys until they are recovered. Define and document the participating-reader protocol: whether read-only commands take the lock or only ensure recovery.
3. **Stale context (ARCH-37).**
   - Context mutations (`use`, `clearUse`, `setMe`, and Board deletion that affects the selected Board) update the **latest** Local State supplied by the plan. They do not update `ctx.local`.
   - After a successful save, one runner-owned step copies the final Local State into `ctx` before reactions run.
   - Update `ctx.me` only when the stored Me selection changed. A Me inferred from the Git email survives unrelated preference changes.
   - Remove the late assignments of stale body results.
   - Nothing synchronizes on rejection or a failed save.
4. **Orphan reservation (RES-07, allocation part).** Allocation treats occupied valid Story folder names as reserved even when `story.json` is absent. Normal listing stays strict. Doctor applies the same rule (WP03 diagnoses orphans).
5. **Prefix freshness (RES-19).** Rebuild the small Board-prefix map for each lookup, or validate the cached Board configuration's freshness. Rebuild-on-miss alone is not enough, because of deletion and prefix reassignment. A retry after a failed index build works. Do not build a watcher or generation service.
6. **Concurrency policy.** Concurrent edits to different fields of the same Story serialize from the latest saved record. Document the policy, and make sure it never silently loses an accepted change.

## Acceptance criteria

- [ ] Two **real CLI subprocesses** creating Stories at the same time return different keys, and both Stories persist (`r01`). Run this 10 times in CI-like conditions with no flake. Use barriers.
- [ ] Concurrent updates to different fields both persist. A plugin file create or edit and a root config change also serialize. A design that locks only around save, or only around applying an already-stale plan, fails these tests.
- [ ] A killed lock owner cannot block the root beyond the documented bound.
- [ ] Killing a subprocess after staging and in the middle of a commit, then reopening, recovers to the complete old or complete new state. Running recovery again is safe (RES-01, ARCH-41).
- [ ] A plugin's Local State update followed by `use`, `clearUse`, or `setMe` preserves the new bag, including across service instances. A transform that adds a local bag during those operations persists, and reactions see the final context. Git-derived Me survives preference changes (ARCH-37).
- [ ] Creation skips an occupied orphan key. A later healthy Story gets none of the orphan's data (RES-07).
- [ ] Two service instances that create, delete, or reassign Board prefixes agree on long-lived Story lookups. A former prefix can't resolve to a changed Board (RES-19).

## Findings

6 rows. Record final statuses in [findings.md](../findings.md#wp02c).

| Finding | Priority | Disposition | Issue | Required outcome |
| --- | --- | --- | --- | --- |
| [ARCH-37](../../../reviews/plugin-architecture/general-architecture.md#arch-37) | P0 | Recommended / see scope | Local State plugin writes are later clobbered by stale in-memory state | Required. |
| [ARCH-41](../../../reviews/plugin-architecture/general-architecture.md#arch-41) | P0 | Selected recoverable-commit guarantee | One save phase does not mean a filesystem transaction | Required. |
| [RES-01](../../../reviews/plugin-architecture/resiliency.md#res-01) | P0 | Recommended / see scope | A Change Set can commit only part of an operation | Required. |
| [RES-02](../../../reviews/plugin-architecture/resiliency.md#res-02) | P0 | Recommended / see scope | Independent operations can both succeed while one is lost | Required. |
| [RES-07](../../../reviews/plugin-architecture/resiliency.md#res-07) | P0 | Recommended / see scope | Orphan folders donate plugin files to newly created Stories | Required. |
| [RES-19](../../../reviews/plugin-architecture/resiliency.md#res-19) | P1 | Recommended / see scope | The prefix cache disagrees with externally changed Boards | Required. |
