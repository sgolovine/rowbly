# WP07B — Performance budgets & plugin test harness

**Depends on:** WP04B, WP08A, WP08B · **Gate:** ✱B · **Wave:** 5 · **Priority:** P2
**Review sources:** [README WP07](../../../reviews/plugin-architecture/README.md#wp07); [PERF-07](../../../reviews/plugin-architecture/other-areas.md#perf-07); [TEST-01](../../../reviews/plugin-architecture/other-areas.md#test-01); [DX-15](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-15); the [historical evidence and limits](../../../reviews/plugin-architecture/other-areas.md#historical-evidence-and-limits).

## Goal

1. A repeatable, opt-in scalability benchmark plus deterministic read-count tests, so that scaling regressions get caught.
2. A small plugin test harness used internally, staged so that WP10B can publish it.

## Owns

- new `test/performance/**`, and a separate opt-in Vitest config or script entry
- new `src/plugin-api/testing.ts`. It is not exported from the package yet; WP10B does that.
- `test/plugins/helpers.ts` and `test/plugins/tuiHelpers.tsx`, to reuse the harness internally
- the `package.json` scripts entry for the benchmark only (for example `bench:plugins`)

## Deliverables

1. **PERF-07.**
   - A schema-validated fixture generator, based on the corrected `gen.mjs` in the evidence, for 100, 1,000, and 5,000 Stories. Doctor must succeed before any timing.
   - Measure startup, activation, pipeline execution with no hooks and with hooks, parsing, Epic summaries, doctor, and bulk writes, each separately.
   - A failed exit invalidates the sample. Report multiple samples, the environment, the fixture size, and the cache state.
   - Add **deterministic read and call-count assertions**, not timing thresholds, for PERF-01 (WP08A), PERF-02, PERF-08, and PERF-09 (WP08B), and PERF-03 and PERF-04 (WP02A), if those packages didn't already add them.
   - Do not disable Zod validation or add global caches.
2. **TEST-01 / DX-15.**
   - `createPluginTestHost({ plugins, boards?, now?, newId?, me? })` returns `{ services, warnings, context(id), dispose() }`. It enables the supplied definitions in an isolated temporary Data Root and runs the real pipeline and storage.
   - `validatePluginDefinition`, re-exported from WP06's validator (DX-32).
   - Keep testing-only unrestricted service helpers distinct from production hook contexts.
   - Reuse the harness in existing plugin service tests to prevent drift.
   - Document the Ink screen-test recipe rather than promising a complete public TUI harness.
   - Never load Vitest or Ink testing libraries from production CLI imports.

## Acceptance criteria

- [ ] `pnpm bench:plugins` (or the documented equivalent) runs the 100, 1,000, and 5,000-Story fixtures and prints samples with environment details. It is not part of `pnpm test`.
- [ ] Read-count tests pin the scaling of PERF-01, PERF-02, PERF-03, PERF-04, PERF-08, and PERF-09: counts scale with records or files, not with cross-products.
- [ ] Two isolated sample plugins get independent roots, status, and contexts. Deterministic values and disposal work. A multi-plugin integration preserves order (TEST-01).
- [ ] A plugin test written with only `src/plugin-api/testing.ts` and `src/plugin-api` (no `src/services`, `src/main`, storage, or `test/` imports) can test set/clear and guard/no-save (DX-15). The external-package variant is WP10B.
- [ ] Production CLI imports don't pull in testing libraries; check the emitted import graph.

## Findings

3 rows. Record final statuses in [findings.md](../findings.md#wp07b).

| Finding | Priority | Disposition | Issue | Required outcome |
| --- | --- | --- | --- | --- |
| [DX-15](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-15) | P2 | Recommended / see scope | Useful repository test helpers are not a public plugin-author harness | Required. |
| [PERF-07](../../../reviews/plugin-architecture/other-areas.md#perf-07) | P2 | Recommended / see scope | No repeatable scalability/read-budget benchmark | Required. |
| [TEST-01](../../../reviews/plugin-architecture/other-areas.md#test-01) | Optional | Optional / bounded | Isolation exists, but authors must assemble internal harness wiring | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
