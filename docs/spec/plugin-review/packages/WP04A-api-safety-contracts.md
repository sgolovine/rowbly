# WP04A — Plugin API safety contracts

**Depends on:** WP00 · **Gate:** ✱A · **Wave:** 1 · **Priority:** P0 (the stage, read, and bag contracts needed by WP01A and WP05A), P1/P2 for the rest
**Review sources:** [README WP04](../../../reviews/plugin-architecture/README.md#wp04); [DX-17](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-17); [ARCH-05](../../../reviews/plugin-architecture/general-architecture.md#arch-05), [ARCH-08](../../../reviews/plugin-architecture/general-architecture.md#arch-08), [ARCH-14](../../../reviews/plugin-architecture/general-architecture.md#arch-14), [ARCH-36](../../../reviews/plugin-architecture/general-architecture.md#arch-36); [CQ-165](../../../reviews/plugin-architecture/code-quality.md#cq-165).

## Goal

Publish, in one coordinated pass, the shared type signatures and the small runtime surface that later packages build on:

- phase-specific contexts and events;
- the `PluginServices` capability projection;
- bag state inspection and strict reads;
- a sound `writeBag`;
- truthful operation results;
- a CLI-only editor.

This package is the **sole editor** of the shared types at this point. Implement each signature honestly. Where enforcement belongs to a later package, say so in the JSDoc. Don't pretend it is already enforced.

## Owns

- `src/services/plugins/types.ts`, `src/services/types.ts`, `src/plugin-api/index.ts`, `src/plugin-api/tui.ts`
- new `src/services/plugins/capabilities.ts`, which builds the `PluginServices` and read-facade projections
- `src/services/fields.ts`, `src/services/boards.ts`, `src/services/context.ts`: ARCH-14 result-shape changes only
- `src/services/plugins/runtime.ts`: context construction only. That means services projection, `editText` removal, `inspectBag`/`requireBag`, `writeBag` typing and root rejection, and passing `result` into pre-save events. **No phase enforcement.** That belongs to WP01A.
- `src/commands/plugins.ts`: the command env's services projection and `editText`
- new compile-fixture tests, for example `test/plugins/apiTypes.test.ts` using `@ts-expect-error`

## May touch

- `src/plugins/specs/commands.ts`: move to `env.editText`/`readText` (ARCH-11). Preserve title semantics exactly: seed the editor with `titledText(initial, title)` **once**, and never re-apply it after the editor returns. Text and file input still apply the title.
- `src/plugins/epics/index.ts`, `src/plugins/specs/index.ts`, `test/plugins/fixtures/notes.ts`: switch Story-create transforms from "first created Story" scans to `result.key` (ARCH-03, DX-08).
- `src/plugins/comments/comments.ts`: the private write helper's typing after CQ-165.
- `src/services/doctor.ts`: a one-line consumer fix that passes `local` into `DoctorData`.
- Every other caller, for compile fixes only (contracts.md §8.2).

## Signatures to publish

WP00's appendix sketches these; refine the names if needed.

1. **Stage contexts:** `PluginReadContext<S>`, `PluginHookContext<S>` (read context + `warn`), and `PluginContext<S>` (commands and screens). Hook contexts expose a **read facade**, `PluginReadServices`. They do **not** expose `operation` or `editText` (DX-17, DX-18).
2. **Events:**
   - `ReplacementEvent<I,S>`: has `core()`, no `result`.
   - `TransformEvent<I,R,S>`: has `result: R` and a writer `PluginChangeSet`.
   - `GuardEvent<I,R,S>`: has `result` and a deeply readonly `PluginChangeSetView` with pending `readFile`; no writers.
   - `ReactionEvent<I,R,S>`: has the final `result` and a saved readonly snapshot.

   `GuardResult` includes an optional `canForce?: boolean`, for UI-01. The guard callback type is `GuardResult | Promise<GuardResult>` (ARCH-33, CQ-24).
3. **Readonly views:** a `DeepReadonly` record type for change views. Document `CQ-27`'s final immutable-view contract in place of the "live view" wording.
4. **Capabilities:** `PluginServices`, which drops `plugins`, `setup`, and doctor mutations, and `PluginReadServices`. Both are built at runtime by `capabilities.ts` and used for both `PluginContext.services` and `PluginCommandEnv.services` (ARCH-05). Remove the full `Services` re-export from the plugin-facing API unless you document a compatibility reason.
5. **Bags:**
   - `inspectBag(record, schema)` returns `{state:'absent'} | {state:'valid', value} | {state:'invalid', raw, issues}`.
   - `requireBag(record, schema)` returns `T | undefined` and throws an attributed `DataIntegrityError` for an invalid bag (ARCH-36, VER-02 protection part).
   - `readBag` stays tolerant, and its JSDoc says so.
   - `writeBag<R>(record: R, bag: Record<string, unknown> | undefined)` returns `Omit<R,'plugins'> & Bagged` (CQ-165, CQ-25).
   - `writeBag` rejects a root config at runtime before any save, using a shape check (ARCH-08, DX-37).
   - Document the root-settings merge recipe that preserves `enabled`.
6. **Core operations:**
   - an authoritative `CORE_OPERATION_NAMES` readonly literal list, with `CoreOperationName` derived from it (also used by WP06 for ARCH-17 and DX-36);
   - truthful input and result types (ARCH-14, CQ-22, CQ-23);
   - an `OperationRunner.run<K extends CoreOperationName>` overload that checks body and final results at compile time.
7. **Doctor types:** `PluginFinding.details?: Record<string, unknown>` and `DoctorData.local: LocalState` (consumed by WP03).
8. **CLI env:** `PluginCommandEnv.editText(initial): Promise<string>`. `PluginContext.editText` is removed (ARCH-11, DX-21, SEC-03).
9. **Exports:** `DataIntegrityError` is exported through the plugin API (needed by `requireBag` callers and WP08A).

The following signatures are **not** in this package. They are granted to later packages: stage-lifetime enforcement (WP01A), the plugin-operation `result` finalizer (WP01B), the form `input` dirty contract and nullable choices (WP05A), and `PluginUi.openStory`/`openTask`/`openBoard` plus screen param typing (WP05B). Typed per-operation input schemas, `filter` vs `input`, Action narrowing, and the alias exports (`PluginCommands`, `PluginOption`) belong to WP04B.

## Deliverables

1. Publish signatures 1–9 with JSDoc that states the stage and the guarantees, with phrasing such as "enforced at runtime by …" where enforcement comes later.
2. ARCH-14: move `{ next, stripped }`, context-refresh data, and Board-deletion LocalState **out** of operation results. Map them before reactions, or carry them in a private side channel. Callers and reactions see the documented public result. Make the matching changes in `fields.ts`, `boards.ts`, and `context.ts`. Do not touch ARCH-37's stale-context logic; WP02C owns that.
3. ARCH-03 / DX-08 / CQ-02: the runtime passes the body or replacement result into transform and guard events. Built-in Story-create transforms use `result.key`, then `changes.updateStory`.
4. ARCH-05 / DX-18: build the runtime projections. Write a test that plugins can't reach `services.plugins.context`, `setup`, or doctor mutations through either the context or the CLI env, while core keeps full `Services`.
5. ARCH-08 / DX-37 / CQ-165 / CQ-25: write the bag APIs and the compile fixture from [CQ-165](../../../reviews/plugin-architecture/code-quality.md#cq-165), in which the cleared bag must not dereference.
6. ARCH-36 / VER-02: deliver `requireBag`/`inspectBag` and their tests. Consumer adoption happens in WP08B and WP08C, and form adoption in WP05A.
7. ARCH-11 / DX-21 / SEC-03: the editor is reachable only from `PluginCommandEnv`. The Specs CLI editor tests (`test/plugins/specsCli.test.ts`) keep their behavior, including title seeding without re-application.
8. Compile fixtures (`@ts-expect-error`):
   - a guard cannot call a writer;
   - a hook context has no `operation` or `editText`;
   - a wrong core body result type is rejected;
   - a cleared `writeBag` result can't be dereferenced;
   - settings inference still works;
   - `guard() {}` with no return still compiles (do not regress DX-34).

## Acceptance criteria

- [ ] Every signature in the list above is published and exported from the intended entry points. The PR body contains a signature appendix that WP01A, WP03, WP05A, WP08B, and WP08C can consume.
- [ ] Reactions to `fields.update`, `boards.remove`, `context.clearUse`, and plugin enable/disable receive the declared public shapes (ARCH-14 probe output). Service callers are unchanged.
- [ ] A replacement that puts two Stories into the Change Set and returns the second one leads Epic and Specs input to apply to the returned Story (ARCH-03).
- [ ] A plugin cannot access another plugin's context, setup, or doctor mutations through the context or the CLI env (ARCH-05).
- [ ] A generic root `writeBag` fails before save. An explicit root-settings merge preserves `enabled` and the other entries. Story, Task, Assignee, and LocalState bag behavior is unchanged (ARCH-08).
- [ ] `requireBag` throws `DATA_INTEGRITY` with plugin, path, and issues on an invalid bag. It returns `undefined` on an absent bag (ARCH-36).
- [ ] No hook or screen context exposes `editText`. The CLI editor honors `VISUAL`/`EDITOR` (SEC-03, ARCH-11).
- [ ] The compile fixtures pass. All existing tests pass, updated only where a result shape intentionally changed (listed in the PR).

## Findings

19 rows. Record final statuses in [findings.md](../findings.md#wp04a).

| Finding | Priority | Disposition | Issue | Required outcome |
| --- | --- | --- | --- | --- |
| [ARCH-03](../../../reviews/plugin-architecture/general-architecture.md#arch-03) | P2 | Recommended / see scope | Pre-save hooks cannot identify the operation's returned entity directly | Required. |
| [ARCH-05](../../../reviews/plugin-architecture/general-architecture.md#arch-05) | P2 | Recommended / see scope | The plugin capability object exposes other plugins' contexts | Required. |
| [ARCH-08](../../../reviews/plugin-architecture/general-architecture.md#arch-08) | P1 | Recommended / see scope | writeBag can overwrite the root's reserved enablement bit | Required. |
| [ARCH-11](../../../reviews/plugin-architecture/general-architecture.md#arch-11) | P2 | Recommended / see scope | The generic context exposes a command-only editor capability | Required. |
| [ARCH-14](../../../reviews/plugin-architecture/general-architecture.md#arch-14) | P1 | Recommended / see scope | Core operation types do not describe all actual runner results | Required. |
| [ARCH-33](../../../reviews/plugin-architecture/general-architecture.md#arch-33) | Optional | Optional / bounded | Guard's return type redundantly includes undefined | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [ARCH-36](../../../reviews/plugin-architecture/general-architecture.md#arch-36) | P0 | Recommended / see scope | Invalid bags look absent and can be overwritten by ordinary mutations | Required. |
| [CQ-02](../../../reviews/plugin-architecture/code-quality.md#cq-02) | Optional | Optional | Repeated discovery of a newly created Story. | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-22](../../../reviews/plugin-architecture/code-quality.md#cq-22) | P2 | Useful | src/services/plugins/types.ts:158/:159: field: unknown, result: unknown[] despite CustomFieldInput/CustomFieldDef schemas/service contracts. Use field: CustomFieldInput, both re… | Required. |
| [CQ-23](../../../reviews/plugin-architecture/code-quality.md#cq-23) | P2 | Useful | src/services/plugins/types.ts:173/:174: Plugin enable/disable result: unknown, though src/services/types.ts:346/:348 specifies { id: string; enabled: boolean }. Use that result … | Required. |
| [CQ-24](../../../reviews/plugin-architecture/code-quality.md#cq-24) | P2 | Useful | src/services/plugins/types.ts:202/:206: GuardResult already includes undefined; use GuardResult \/ Promise<GuardResult>. Remove redundant \/ undefined from the verdict annotatio… | Required. |
| [CQ-25](../../../reviews/plugin-architecture/code-quality.md#cq-25) | P2 | Useful | src/services/plugins/types.ts:250, src/services/plugins/runtime.ts:191/:193: bag: object admits arrays/classes while persisted bags are Record<string, unknown>; implementation c… | Required. |
| [CQ-165](../../../reviews/plugin-architecture/code-quality.md#cq-165) | P2 | Recommended | writeBag promises a generic subtype it does not preserve. | Required. |
| [DX-08](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-08) | P2 | Recommended / see scope | New Story lookup is repetitive and has an implicit subject assumption | Required. |
| [DX-18](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-18) | P2 | External milestone | Production context exposes the entire service layer without phase guidance | Implement per the package / §9 decision; if the condition does not apply, `deferred: <condition>`. |
| [DX-21](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-21) | P2 | Recommended / see scope | Editor launch is visible in TUI and hook contexts despite being CLI-only | Required. |
| [DX-37](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-37) | P2 | Recommended / see scope | Generic bag writing on root settings can drop activation | Required. |
| [SEC-03](../../../reviews/plugin-architecture/other-areas.md#sec-03) | P2 | Recommended / see scope | Command-only editor restriction is unenforced at runtime | Required. |
| [VER-02](../../../reviews/plugin-architecture/other-areas.md#ver-02) | Optional | Optional / bounded | Invalid bags can be mistaken for absent data; migration policy is undefined | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
