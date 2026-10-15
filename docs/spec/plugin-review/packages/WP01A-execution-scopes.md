# WP01A — Execution scopes & immutable views

**Depends on:** WP04A · **Wave:** 2 · **Priority:** P0 · **Critical path:** yes
**Review sources:** [README WP01](../../../reviews/plugin-architecture/README.md#wp01); [RES-05](../../../reviews/plugin-architecture/resiliency.md#res-05), [RES-06](../../../reviews/plugin-architecture/resiliency.md#res-06); [ARCH-06](../../../reviews/plugin-architecture/general-architecture.md#arch-06), [ARCH-23](../../../reviews/plugin-architecture/general-architecture.md#arch-23), [ARCH-39](../../../reviews/plugin-architecture/general-architecture.md#arch-39); [DX-17](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-17).

## Goal

Enforce D3 and D4 at runtime:

- nested mutations from hooks are rejected before any save;
- guards and reactions get deeply immutable snapshots;
- transforms mutate only through writer methods that expire with their stage;
- snapshots cannot redirect deletions or poison the plan;
- the plan is sealed before guards and before commit.

This must land before WP02C enables the non-reentrant lock.

## Owns

- `src/services/plugins/runtime.ts`
- `src/services/plugins/changeSet.ts`: views, snapshots, writer lifetime, and sealing only. WP02A then owns identities, scopes, and validation.
- new `src/services/plugins/executionScope.ts` (`AsyncLocalStorage`: operation ID, plugin ID, operation name, stage)
- `src/services/doctor.ts`: route plugin doctor-fix callbacks through the same phase helper. Wrapping only; WP03 owns the pass logic.
- `src/services/index.ts`, if wiring needs it
- new tests: `test/plugins/reentrancy.test.ts`, `test/plugins/changeSetIsolation.test.ts`

## Type grant

Within `src/services/plugins/types.ts`, you may refine only the stage-context and view blocks that WP04A published, for example the `PluginHookContext`, `GuardEvent`, and `ReactionEvent` shapes. Keep the semantics. List every type edit in the PR.

## Deliverables

1. **Execution scope (D4, RES-05, ARCH-06, DX-17).**
   - Track the active operation and stage with `AsyncLocalStorage`.
   - Mutating entry points throw an attributed error before any I/O when they are called from `replacement`, `transform`, `guard`, `reaction`, `doctor-fix`, or a running plugin operation `body`. Those entry points are `ops.run` for core mutations and `plugin.operation`. The error names the originating plugin and stage, and points to the current Change Set.
   - Reads stay allowed. A replacement's `core()` runs inside the current plan.
   - Unrelated concurrent operations are not affected; for example, a TUI action can run while a background reaction is pending.
   - A captured command or screen context used inside a hook is also caught, because enforcement lives at entry and does not depend on which object was used.
   - Doctor fixes run inside the same scope.
   - Also enforce the rule at the **writer methods** (ARCH-39). Operation-entry checks alone can't stop a captured `changes.updateStory` call.
2. **Immutable views (D3, RES-06, ARCH-23, ARCH-39).**
   - Keep the collector private. `view()` returns detached, deeply frozen snapshots. Accessors return the current snapshot, so later valid writes are visible to the active facade.
   - Update callbacks receive copies. A callback that mutates and then throws leaves the pending record intact.
   - `before` stays the original record. Snapshot mutation can never reach the plan or another hook's view.
   - Create one frozen post-save snapshot and share it across all reactions.
   - Pin the active plugin set per operation, rather than iterating the live host array during reload or failure.
   - Seal the plan before guards and before commit. Writers then throw.
3. **Writer lifetime.** Bind each writer handle to its invocation. A handle retained and then used from a guard, a reaction, a later continuation, or after sealing throws without changing the plan. Promise timeouts don't stop detached code; document this (D8). WP01B adds timeouts and revokes handles on timeout.
4. **Coordinator seam (for WP02C).** Expose `enter`/`exit` hooks around a whole operation in the runner, with a no-op default, so that WP02C can plug in the lock without restructuring the runtime. Coordination must wrap the operation body **including** its initial reads.
5. **CQ-27:** document the final immutable-view contract in JSDoc, replacing the "live view" wording.
6. **CQ-35:** remove the redundant `forPlugin(id) as PluginChangeSet` casts in `runtime.ts` and `doctor.ts`.
7. **CQ-36 (withdrawn).** Keep building a fresh event object for each phase. Do not memoize events: that would let a transform's mutation of the event object leak into guards.
8. Update existing tests that rely on live mutable views only where the contract intentionally changed. List them.

## Acceptance criteria

- [ ] A transform that calls a mutating core service or `plugin.operation` saves nothing and returns an attributed error. The outer operation also saves nothing (RES-05, from the `r02-reentrancy` reproduction).
- [ ] A recursive hook stops at the first nested call.
- [ ] Reads remain available inside hooks. Replacement `core()` works and keeps its core error codes.
- [ ] An unrelated user operation proceeds while a delayed reaction is pending.
- [ ] Doctor-fix callbacks cannot start nested operations.
- [ ] Mutating `changes.story('WEB-1').before.key` in a remove transform cannot redirect the deletion (the `extra.ts` reproduction). Pushing onto or editing view arrays has no effect on disk or on other hooks.
- [ ] A guard that mutates `changes.changes[...]` cannot change the persisted Story (the ARCH-39 probe). Writers are compile-time errors in guards (WP04A types) and runtime errors.
- [ ] A transform writer retained and used later, from a guard, a reaction, a late continuation, or after sealing, throws without changing the plan.
- [ ] Reaction A's mutation attempt cannot change reaction B's event. Reactions see final transformed data.
- [ ] Existing pipeline order, replacement behavior, and attribution tests pass.

## Findings

9 rows. Record final statuses in [findings.md](../findings.md#wp01a).

| Finding | Priority | Disposition | Issue | Required outcome |
| --- | --- | --- | --- | --- |
| [ARCH-06](../../../reviews/plugin-architecture/general-architecture.md#arch-06) | P0 | Recommended / see scope | Hooks can start independent nested operations | Required. |
| [ARCH-23](../../../reviews/plugin-architecture/general-architecture.md#arch-23) | P0 | Recommended / see scope | Reactions receive a live, shallow-readonly Change Set | Required. |
| [ARCH-39](../../../reviews/plugin-architecture/general-architecture.md#arch-39) | P0 | Recommended / see scope | Guards get writer methods and can modify the supposedly final Change Set | Required. |
| [CQ-27](../../../reviews/plugin-architecture/code-quality.md#cq-27) | P0 dependency | Superseded by RES-06 / ARCH-39 | Document the final immutable view contract; do not preserve live-mutability guidance. | Required. |
| [CQ-35](../../../reviews/plugin-architecture/code-quality.md#cq-35) | P2 | Useful | src/services/plugins/runtime.ts:206, src/services/doctor.ts:545: changes.forPlugin(id) as PluginChangeSet is redundant; method already returns that type. Delete both casts and u… | Required. |
| [CQ-36](../../../reviews/plugin-architecture/code-quality.md#cq-36) | None | Withdrawn | src/services/plugins/runtime.ts:68: rebuilding event objects per phase is small and unmeasured. A memoized map adds state and lets a transform's event-object mutation leak into … | None — withdrawn by the review. Do not implement the original prescription; any residual note in the package is optional. |
| [DX-17](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-17) | P0 | Recommended / see scope | Hook types expose nested writes and guards expose mutable Change Sets | Required. |
| [RES-05](../../../reviews/plugin-architecture/resiliency.md#res-05) | P0 | Recommended / see scope | Reentrant handler mutations save independently and overwrite each other | Required. |
| [RES-06](../../../reviews/plugin-architecture/resiliency.md#res-06) | P0 | Recommended / see scope | Change Set views expose mutable internal state and source identities | Required. |
