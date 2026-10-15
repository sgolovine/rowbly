# WP02B — Storage commit engine: atomic files, journal, lock primitive

**Depends on:** WP00 · **Gate:** ✱A · **Wave:** 1 · **Priority:** P0 · **Critical path:** yes (WP02A integrates this engine)
**Review sources:** [README WP02](../../../reviews/plugin-architecture/README.md#wp02); [RES-01](../../../reviews/plugin-architecture/resiliency.md#res-01), [RES-02](../../../reviews/plugin-architecture/resiliency.md#res-02), [RES-03](../../../reviews/plugin-architecture/resiliency.md#res-03), [RES-04](../../../reviews/plugin-architecture/resiliency.md#res-04), [RES-21](../../../reviews/plugin-architecture/resiliency.md#res-21); [ARCH-41](../../../reviews/plugin-architecture/general-architecture.md#arch-41); [SEC-02](../../../reviews/plugin-architecture/other-areas.md#sec-02).

## Goal

Build the storage-layer primitives that ADR-0019 specifies, as pure storage modules that the Change Set does not use yet:

1. atomic text and JSON replacement;
2. a recoverable multi-file transaction (staging, durable manifest, apply, complete, idempotent recovery);
3. folder moves with preflight;
4. a cross-process Data Root lock;
5. the symlink policy.

WP02A wires the Change Set onto (1–3). WP02C wires operations onto (4) and runs recovery at startup. Splitting the work this way lets the engine be built and failure-tested alongside WP04A and WP01A.

The review asks that "staging, journaling, and recovery [be split] into reviewable commits under one owner". Land this package as a series of commits in that order.

## Owns

- `src/storage/system.ts`: atomic writes
- `src/storage/files.ts`: move preflight and staging
- new `src/storage/transaction.ts`, or a `src/storage/transaction/` folder: the journal, apply, and recovery
- new `src/storage/lock.ts`: the coordinator primitive
- new `src/storage/pathPolicy.ts`, or equivalent: containment and symlink checks (RES-21, the W5 policy)
- `src/storage/index.ts`: exports
- `.gitignore`: journal and lock artifacts, if they live under the Data Root and should be ignored in repositories that commit `.rowbly/`. Document the decision.
- new tests: `test/storage/textAtomicity.test.ts`, `test/storage/transaction.test.ts`, `test/storage/lock.test.ts`, `test/plugins/filePaths.test.ts`, and the engine part of `test/plugins/moveRecovery.test.ts`

## Must not touch

`src/services/**`, `changeSet.ts`, and `runtime.ts`. The integration work belongs to WP02A and WP02C.

## Deliverables

1. **RES-03: atomic text writes.** `writeTextFile` writes to a unique temporary file in the same directory and renames it over the destination only after the write completes. Handled errors clean up the temporary file, and the cleanup never masks the original error. JSON writes keep their current validation and formatting: stable key order, two spaces, trailing newline. Apply the W4 durability policy.
2. **The transaction engine (RES-01 and ARCH-41 groundwork).** The API looks roughly like `prepare(plan) → Transaction`, `commit()`, and `recover(root)`. It covers:
   - JSON record replacement;
   - plugin file replacement and removal;
   - Story folder renumbering, which is a move;
   - deletion of Story and Board folders, whose originals are kept recoverable until completion.

   Before any live mutation, stage all content and write the manifest. Recovery follows ADR-0019: roll forward prepared transactions and restore unprepared ones. It is idempotent and safe to interrupt and rerun. Report the affected paths when recovery fails, and never claim "nothing saved" in that case.
3. **RES-04: preflight folder moves** against the complete move set before staging anything. An occupied destination is allowed only if it is itself a source being moved away in the same plan. Otherwise fail before touching any source. Record the original, staged, and final paths in the manifest. Hidden `.moving` folders must never be left behind after a handled error.
4. **The lock (D1 / W2):**
   - `acquire(root, { timeoutMs })` canonicalizes the root with realpath, waits a bounded time, and recovers a stale owner according to the documented rule.
   - Release happens on every path, as a `using`/`try…finally` helper.
   - It is reentrant only within the same operation context. WP02C supplies that context. Here, provide an explicit handle type.
   - It is not tied to a service instance.
5. **RES-21 / W5: path policy.** Resolve the physical scope root once. Reject symlinked parents or targets inside plugin scopes for read, write, list, and delete, while allowing a symlinked Data Root. Document that this is not race-proof against an adversary. Provide the checks as functions; WP02A calls them from Change Set path resolution.
6. **Tests.** Use failure injection that doesn't depend on chmod, so the tests work as root: wrap the fs calls behind a small injectable seam.
   - Fail at each step: stage, manifest write, each apply, completion marker, and recovery.
   - Interrupt a second time during recovery.
   - Run a subprocess that is killed at each durable checkpoint, then recover by reopening the root.
   - Text truncation: one test with `ulimit -f` in a subprocess, behind a platform guard, matching `text-failure.ts`.
   - Two processes contend for the lock. A dead owner is recovered.

## Acceptance criteria

- [ ] An injected short or failed write preserves the entire original bytes, including the final newline. A successful write replaces the whole file. Cleanup doesn't mask the original error (RES-03).
- [ ] Failure injection at every engine write, move, delete, or manifest step, followed by `recover`, yields exactly the complete old state or the complete new state. Running `recover` again is a no-op. Killing a subprocess mid-commit and then recovering behaves the same way.
- [ ] An occupied move target fails before any source moves. A successful swap, where A becomes B and B becomes A within one plan, works. No `.moving` folder survives a handled error (RES-04 engine part).
- [ ] Two processes cannot hold the lock at once. A lock left by a killed process is recovered within the documented bound. Aliased root paths share one lock.
- [ ] Linked plugin roots, nested parents, and linked targets are rejected, and outside sentinel bytes stay unchanged. Normal nested names still work (RES-21).
- [ ] No service code uses the engine yet. The existing suite is unchanged and green.

## Findings

3 rows. Record final statuses in [findings.md](../findings.md#wp02b).

| Finding | Priority | Disposition | Issue | Required outcome |
| --- | --- | --- | --- | --- |
| [RES-03](../../../reviews/plugin-architecture/resiliency.md#res-03) | P0 | Recommended / see scope | A failed text write destroys the original plugin file | Required. |
| [RES-04](../../../reviews/plugin-architecture/resiliency.md#res-04) | P0 | Recommended / see scope | Folder staging failures make Stories inaccessible | Required. |
| [RES-21](../../../reviews/plugin-architecture/resiliency.md#res-21) | P3 / containment policy | Policy decision; before confinement claims | Valid plugin paths follow symlinks outside their scope | Implement per the package / §9 decision; if the condition does not apply, `deferred: <condition>`. |

RES-01 and ARCH-41 are closed by WP02C, once the integrated old/new-after-recovery guarantee is proven end to end. This package delivers their engine. Note in the PR which parts of those findings' acceptance criteria the engine tests already cover.
