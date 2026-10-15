# WP05A — Plugin form data preservation & field isolation

**Depends on:** WP04A, WP05O · **Wave:** 2 · **Priority:** P0 (preservation), P1 (containment)
**Review sources:** [README WP05](../../../reviews/plugin-architecture/README.md#wp05); [RES-11](../../../reviews/plugin-architecture/resiliency.md#res-11), [RES-12](../../../reviews/plugin-architecture/resiliency.md#res-12) (field isolation); [DX-09](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-09), [DX-31](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-31), [DX-20](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-20); [ARCH-36](../../../reviews/plugin-architecture/general-architecture.md#arch-36) (form part); [CQ-79](../../../reviews/plugin-architecture/code-quality.md#cq-79).

## Goal

Two problems: an unrelated Story or Task form edit must never erase plugin data, and one broken plugin field provider must never block the core form or filters. To get there:

- submit plugin input only for providers that loaded successfully **and** whose fields actually changed;
- make clearing explicit;
- isolate each provider behind an attributed boundary.

The supervisor reproduced this exact data loss: a default plugin form input removed both bags, and doctor then reported no issue.

## Owns

- `src/tui/screens/stories/pluginFields.ts`
- `src/tui/screens/stories/StoryFormScreen.tsx` and `StoryListScreen.tsx` (renamed by WP05O): plugin field and filter wiring, and CQ-79
- `src/tui/screens/tasks/TaskFormScreen.tsx`: plugin field wiring, if Task forms collect plugin fields
- `src/tui/screens/board/BoardScreen.tsx`: plugin filter wiring only
- `src/tui/components/Form.tsx`: normalized-value comparison, plus the nullable choice only if DX-20 is selected
- new tests: `test/plugins/invalidBagPreservation.test.tsx`, and the field/filter part of `test/plugins/tuiFailureIsolation.test.tsx`

## Type grant

The `PluginStoryForm`, `PluginStoryFilter`, `PluginFormField`, and `PluginFormValue` blocks in `types.ts` (DX-09, DX-20, CQ-18 coordination).

## May touch

`src/plugins/epics/tui.ts`, `src/plugins/specs/tui.ts`, `test/plugins/fixtures/notesTui.tsx`: consumer compile fixes for the new `input` signature, plus the **minimum** change needed so that they never emit clearing input for an unchanged field. Plugin-specific polish stays in WP08A and WP08B: CQ-97, CQ-123, CQ-166.

## Deliverables

1. **The dirty contract (DX-09, D6).**
   - Change `PluginStoryForm.input` to receive `{ values, initialValues, changedFields, story }`.
   - Compare **normalized** form values: missing or default, number `null`, boolean `false`, and array equality. Never compare a submitted number against an initial raw string.
   - The host calls a plugin's `input` only when at least one of that plugin's fields changed. Otherwise the plugin contributes no payload at all.
   - `undefined` means "no change". An explicit clear is a deliberate value the plugin defines, for example `{ epic: null }`.
   - Document the create/edit truth table in the JSDoc.
2. **Invalid and unsupported bags in forms (ARCH-36 form part, RES-11).**
   - When a provider's stored bag is invalid (detect this with `inspectBag`), show the field as unavailable ("stored value is invalid; kept unchanged").
   - Do not seed a default that would later be submitted.
   - Give the user an explicit reset action that is a dirty clear.
   - An unrelated core edit leaves the raw bag semantically identical, including unknown keys, and doctor still reports the issue afterward.
3. **Per-provider isolation (DX-31, RES-12 field part).**
   - Collect each provider's fields through an attributed boundary. Use WP01B's adapter if it has merged; until then, use a local attributed try/catch that WP01B replaces.
   - Warn once, and keep the list of providers that succeeded.
   - At submission, gather input only from successful **and** dirty providers.
   - Failed providers are also excluded from filter conversion and descriptions.
   - Show "Plugin fields unavailable; stored data kept" where appropriate. Core editing and the other plugins keep working.
   - An input conversion failure blocks that submission with attribution. It is never silently ignored.
   - Wrap filter-summary callbacks (around `pluginFields.ts:80`) as well.
4. **CQ-79.** Narrow assignees with `Array.isArray` plus string checks, and validate priority with `PrioritySchema.safeParse`. Malformed values produce a validation error. They can never clear data.
5. **DX-20 (optional, bounded).** If shared Form support for nullable choices removes real sentinel risk, add a small `noneLabel` or typed `{label, value: string | null}` choice. Keep "any" in filters distinct from "without value". Otherwise document the sentinel recipe and defer.
6. **CQ-61 (optional).** Rename `collect`/`gather` → `collectPluginFields`/`gatherPluginInput`.

## Acceptance criteria

- [ ] Editing only a Story's name while the Epic and Specs bags are invalid or future leaves both raw bags semantically identical, including unknown keys. Doctor still reports them. This is the `r13-invalid-bag-dropped` reproduction, which now passes as a regression test.
- [ ] Unchanged valid bags are untouched. Changing an existing value to empty clears it. Creating with an empty value writes no bag. Zero, `false`, and `[]` survive (no truthiness bugs). Removing one plugin's bag preserves the others.
- [ ] A throwing provider (fixture) leaves the core form and the healthy plugin fields usable, and saving a core name preserves the failed plugin's data. A provider that would emit `{ x: null }` on absent values emits nothing when it fails or is unchanged.
- [ ] One corrupt Epic does not prevent editing core fields or loading another plugin's fields. Board and Story filters stay usable without that plugin's criterion.
- [ ] Failure warnings name the plugin and the stage (`field`, `input`, `filter`, `filter-summary`), with no duplicate toasts.
- [ ] Malformed assignee or priority form values cannot clear data or bypass validation (CQ-79).

## Findings

6 rows. Record final statuses in [findings.md](../findings.md#wp05a).

| Finding | Priority | Disposition | Issue | Required outcome |
| --- | --- | --- | --- | --- |
| [CQ-61](../../../reviews/plugin-architecture/code-quality.md#cq-61) | Optional | Optional | src/tui/screens/stories/pluginFields.ts:26/:84: private collect/gather are generic. Optional rename to collectPluginFields/gatherPluginInput. They do not actually collide with t… | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-79](../../../reviews/plugin-architecture/code-quality.md#cq-79) | P2 | Useful | src/tui/screens/stories/form.tsx:44/:45: casts (values.assignees as string[] \/ null) ?? [] and optional(values.priority) as Priority \/ null trust a broad form union. Narrow As… | Required. |
| [DX-09](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-09) | P0 | Recommended / see scope | Empty TUI values must mean clear on edit, not “no input” | Required. |
| [DX-20](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-20) | Optional | Optional / bounded | Nullable selects require plugin-defined string sentinels | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [DX-31](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-31) | P1 | Recommended / see scope | A failing field provider blocks the core form; skipping it must not send clear input | Required. |
| [RES-11](../../../reviews/plugin-architecture/resiliency.md#res-11) | P0 | Recommended / see scope | Invalid bags are overwritten as if they were empty | Required. |
