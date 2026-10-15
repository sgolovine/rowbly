# WP01B — Callback invocation, error policy, reactions & results

**Depends on:** WP01A, WP06 · **Wave:** 3 · **Priority:** P1
**Review sources:** [README WP01](../../../reviews/plugin-architecture/README.md#wp01); [ARCH-04](../../../reviews/plugin-architecture/general-architecture.md#arch-04), [ARCH-42](../../../reviews/plugin-architecture/general-architecture.md#arch-42); [RES-15](../../../reviews/plugin-architecture/resiliency.md#res-15), [RES-16](../../../reviews/plugin-architecture/resiliency.md#res-16), [RES-18](../../../reviews/plugin-architecture/resiliency.md#res-18) (B); [DX-19](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-19), [DX-39](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-39); [OBS-02](../../../reviews/plugin-architecture/other-areas.md#obs-02); [CQ-33–39](../../../reviews/plugin-architecture/code-quality.md#cq-33).

## Goal

Build one invocation and error adapter that every host-controlled plugin callback goes through, applying the D7 error policy (which amends ADR-0012). On top of that:

- give reactions a bounded, tracked lifetime;
- define the replacement `core()` rule;
- return final, post-transform results from every operation.

## Owns

- `src/services/plugins/runtime.ts`
- new `src/services/plugins/invoke.ts`: the adapter
- `src/services/stories.ts`: wrap `filterStories` only (RES-16)
- `src/services/plugins/service.ts`: route rows through the adapter
- `src/services/context.ts`, `src/services/stages.ts`: ARCH-42 finalizers only
- `src/commands/plugins.ts`, `src/commands/_shared.ts`: wrap command actions and option-input conversion only (RES-16)
- `test/plugins/pipeline.test.ts`, `test/plugins/cli.test.ts`: update the tests that encode ADR-0012's blanket wrapping
- new tests: `test/plugins/cliFailureAttribution.test.ts`, `test/plugins/reactionTimeout.test.ts`, `test/plugins/asyncFailure.test.ts`, `test/plugins/results.test.ts`

## Type grant

The plugin-operation options block in `types.ts`: an optional `result(changes, bodyResult)` finalizer on `plugin.operation`, and its result typing.

## Does not own

- The TUI call sites (field providers, Actions, slots). WP05B adopts the adapter there.
- Doctor check and fix call sites. WP03 adopts the adapter there.
- The Comments and Specs result finalizers. WP08C and WP08B adopt those.

## Deliverables

1. **The adapter (D7, ARCH-04, DX-39, OBS-02, RES-16).**
   - `invokePlugin({ pluginId, operation?, stage }, fn)` handles both synchronous throws and returned rejections.
   - It keeps expected Rowbly errors (`Usage`, `Validation`, `NotFound`, `Conflict`, `DataIntegrity`), along with their code, exit code, hint, and issues, and adds `details.plugin`, `details.operation`, and `details.stage`. Framework attribution takes precedence.
   - It wraps unexpected throws, including non-`Error` values, as `PluginError` with a disable hint.
   - It does not wrap an already-attributed error a second time. Replacement `core()` errors pass through.
   - Apply it to: hooks, plugin operation bodies, CLI command actions, option-input conversion, `filterStories`, and rows.
   - A guard that throws an expected error yields that error's code. `{ reject, hint }` stays `CONFLICT`.
   - Pass the forceable signal `canForce` through to the `ConflictError` details. WP08B consumes it for UI-01.
   - Update ADR-0012-era test expectations. Generic `TypeError` and `Error` throws still expect `INTERNAL`.
2. **Reactions (RES-15, W7).**
   - Each reaction gets a bounded deadline. On timeout, warn with the plugin, operation, and timeout, then continue with the later reactions.
   - The CLI waits long enough to print its normal result and exits 0.
   - Timers are cleared on settlement. Late rejections are swallowed and logged as warnings.
   - Writer handles were already revoked by WP01A's sealing.
   - The TUI keeps running reactions in the background. Document the ordering policy for overlapping background reactions. Reactions never undo committed data.
   - Do **not** add deadlines around every API, and do not claim that timeouts stop synchronous loops (D8).
3. **RES-18B, detached work.**
   - Document that plugin work must be returned or awaited.
   - Add subprocess fixtures showing supported (awaited rejection) and unsupported (detached throw) behavior.
   - No global `uncaughtException` handler that claims safe continuation, and no unused global task registry.
4. **DX-19 / W6.**
   - Replacement `core()` is call-once. A second call throws an attributed `PluginError` and saves nothing.
   - Keep replacements supported. The Docs handoff covers the advanced section: result obligations, error pass-through, the shared pending Change Set, order, and deliberately not calling `core()`.
5. **ARCH-42, final results (§6).**
   - Concrete finalizers for core records, arrays (Stages), and LocalState.
   - The optional own-operation `result(changes, bodyResult)` finalizer. It is a pure read of pending data.
   - Callers and reactions receive identical final values.
   - W11: if a transform removes the returned entity, fail before save with an attributed `ConflictError`.
   - The Comments and Specs adoptions are WP08C and WP08B.
6. **Cleanups:**
   - CQ-33: a private `replacementFor()` with one documented widening cast. Carry `{ plugin, replace }` together.
   - CQ-34: a `HandlerStage` union.
   - CQ-37 (optional): `coreErrors`.
   - CQ-39 (optional): a cache-membership comment.
   - CQ-08 (optional): `errorMessage(error: unknown)` in `src/core/errors.ts`, used where it replaces local copies.
   - CQ-38 is merged into CQ-165 (WP04A).

## Acceptance criteria

- [ ] Malformed Epic input exits 2 (`VALIDATION`). Missing requested links exit 3 (`NOT_FOUND`). A refused deletion stays exit 4 (`CONFLICT`). Unexpected fixture throws stay exit 1 (`INTERNAL`). None of these save or react. JSON diagnostics keep their attribution and issues (ARCH-04; use the CLI recipe in the ARCH-04 evidence).
- [ ] Throws from a command, a filter, option input, a custom body, and a non-`Error` value all produce plugin attribution. Expected errors keep exit codes 2, 3, and 4. Replacement core errors keep their codes. The CLI JSON keeps its current top-level schema (RES-16, OBS-02).
- [ ] A filter exception fails the list visibly. It is never reported as empty results (DX-39).
- [ ] A reaction that never resolves times out with a warning that includes the plugin ID. The operation returns the saved result. The CLI exits 0. A later reaction still runs. No timer leaks after successful reactions (RES-15).
- [ ] A second replacement `core()` call fails with a precise diagnostic and saves nothing.
- [ ] A fixture transform that changes a Stage, LocalState, and a plugin-owned record gives the caller and the reaction the same final value as the persisted data (ARCH-42 core part).
- [ ] The async-failure fixtures document awaited versus detached behavior (RES-18B).

## Findings

14 rows. Record final statuses in [findings.md](../findings.md#wp01b).

| Finding | Priority | Disposition | Issue | Required outcome |
| --- | --- | --- | --- | --- |
| [ARCH-04](../../../reviews/plugin-architecture/general-architecture.md#arch-04) | P1 | Selected contract change | Expected plugin input errors become INTERNAL failures | Required. |
| [ARCH-42](../../../reviews/plugin-architecture/general-architecture.md#arch-42) | P1 | Recommended / see scope | Final result refresh is opt-in and incomplete | Required. |
| [CQ-08](../../../reviews/plugin-architecture/code-quality.md#cq-08) | P2 | Useful | Repeated error-to-string conversion includes one unsafe variant. | Required. |
| [CQ-33](../../../reviews/plugin-architecture/code-quality.md#cq-33) | P2 | Useful | Replacement lookup buries the necessary heterogeneous-type boundary. | Required. |
| [CQ-34](../../../reviews/plugin-architecture/code-quality.md#cq-34) | P2 | Useful | src/services/plugins/runtime.ts:139: stage: string is used only as replacement, transform, guard. Use private HandlerStage union. Do not change general PluginError.details into … | Required. |
| [CQ-37](../../../reviews/plugin-architecture/code-quality.md#cq-37) | Optional | Optional | src/services/plugins/runtime.ts:141: optional passThrough WeakSet could be named coreErrors, matching its sole caller fromCore at :86. | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-38](../../../reviews/plugin-architecture/code-quality.md#cq-38) | See linked finding | Merged | src/services/plugins/runtime.ts:196: rest as R is not merely a TS rest-typing limitation; the promised subtype is false. | None separately — resolved by CQ-165. |
| [CQ-39](../../../reviews/plugin-architecture/code-quality.md#cq-39) | Optional | Optional | src/services/plugins/runtime.ts:44 caches contexts; src/services/plugins/runtime.ts:48 checks active membership before retrieving them. No cache-lifetime bug shown. Optional com… | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [DX-19](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-19) | P2 | Useful advanced reference; relocation optional | Replacements are advanced and should be taught as such | Required (optional sub-parts per entry). |
| [DX-39](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-39) | P1 | Recommended / see scope | Non-hook callbacks lack uniform plugin/stage error attribution | Required. |
| [OBS-02](../../../reviews/plugin-architecture/other-areas.md#obs-02) | P1 | Recommended / see scope | Attribution is incomplete outside protected pipeline hooks | Required. |
| [RES-15](../../../reviews/plugin-architecture/resiliency.md#res-15) | P1 | Recommended / see scope | An unresolved reaction prevents completion and blocks later reactions | Required. |
| [RES-16](../../../reviews/plugin-architecture/resiliency.md#res-16) | P1 | Recommended / see scope | Command, filter, and option conversion errors omit plugin identity | Required. |
| [RES-18B](../../../reviews/plugin-architecture/resiliency.md#res-18) | P1 | Recommended / see scope | Detached promises/timers escape returned-promise catches: document the limit and add supported/unsupported subprocess fixtures | Required. |
