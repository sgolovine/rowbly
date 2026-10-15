# WP08A — Epics plugin

**Depends on:** WP02A, WP05A, WP05B · **Wave:** 4 · **Priority:** P1 (corrupt-file recovery, pending-read guards, PERF-01 scale gate under U2), P2/optional for the rest
**Review sources:** [README WP08](../../../reviews/plugin-architecture/README.md#wp08); [RES-12](../../../reviews/plugin-architecture/resiliency.md#res-12); [ARCH-07](../../../reviews/plugin-architecture/general-architecture.md#arch-07), [ARCH-12](../../../reviews/plugin-architecture/general-architecture.md#arch-12) (Epics part), [ARCH-30](../../../reviews/plugin-architecture/general-architecture.md#arch-30); [PERF-01](../../../reviews/plugin-architecture/other-areas.md#perf-01); [CQ-80–102](../../../reviews/plugin-architecture/code-quality.md#cq-80).

## Goal

1. A corrupt or future-version Epic file is diagnosed precisely, preserved, and never blocks core forms or other Epics.
2. Epic guards see pending files.
3. The Epic list loads Stories once, not once per Epic.
4. Stories in an Epic open in core Story detail.
5. Apply the local cleanups.

## Owns

- `src/plugins/epics/**`
- `test/plugins/epics*.test.ts(x)`, new `test/plugins/epicsCorruption.test.ts`

## Deliverables

1. **RES-12 / ARCH-12 (Epics part).**
   - Put Epic file reading and writing in a private `epicFile.ts`. It parses each owned file independently. Malformed JSON, conflict markers, schema errors, unsupported versions, and ID/filename mismatches become `DataIntegrityError` with the relative path (exit 6).
   - Valid writes keep their format. A missing Epic is `NOT_FOUND`.
   - The Epic doctor check validates **every** owned file and reports its actual path and problem. One bad file never stops the check of the rest, and the check never rewrites a file.
   - Listing, form fields, and filter fields degrade per file. A corrupt Epic is shown as unavailable, and the other Epics still load.
   - Never silently unlink references to a corrupt but present Epic.
   - CQ-85: validation messages include field-level issues and the context (`Epic input` or `Epic patch`).
2. **ARCH-30.** `guardLink` reads the requested Epic through the Change Set's read-only pending file view, not through `plugin.files`. A replacement that creates or deletes an Epic in the same operation is seen correctly.
3. **PERF-01 / CQ-89 / CQ-92 / CQ-88.**
   - `listEpicSummaries(plugin, mode)` lists Epics once and Stories once, and loads effective Stage configuration once per relevant Board. It builds per-Epic and per-Board groups and done counts in Maps.
   - Share a small progress builder with `showEpic`.
   - Name `EpicProgress` and `EpicSummary` in `model.ts`.
   - Switch `EpicList` to the summaries.
   - No persistent or process-global cache.
   - Un-export `epicStories` if it stays.
4. **ARCH-07 (consumer).** EpicDetail's Stories are selectable and open core Story detail through `ui.openStory`. Back returns to the Epic.
5. **Reload on return (ARCH-26 consumer, CQ-99).** Migrate `EpicList` and `EpicDetail` to `useReloadOnReturn` where it is equivalent. Otherwise add the explanatory comment.
6. **Form adapter (with WP05A's contract).**
   - CQ-97: replace the nested ternaries with early returns. `undefined` means unchanged; `null` means explicit clear.
   - CQ-96: `NO_EPIC` / `ALL_EPICS` constants.
   - A missing selected Epic stays visible and removable.
   - "All Epics" (no filter) and "No Epic" (unset) stay distinct.
7. **Small items:**
   - CQ-81: `linkEpicOption` / `clearEpicOption`.
   - CQ-82: validate the Epic filter once at the boundary.
   - CQ-94: check for "nothing to update" before the read, and define the error precedence.
   - Optional: CQ-80 (no parse cache), CQ-83 (decide and document no-settings behavior; coordinate with WP04B's CQ-53), CQ-84, CQ-86, CQ-87, CQ-90, CQ-93, CQ-95, CQ-100.
   - Withdrawn: CQ-91, CQ-98, CQ-101, CQ-102.
   - Merged: CQ-16, into CQ-97, CQ-100, CQ-103, CQ-122, and CQ-128.

## Acceptance criteria

- [ ] With `bad.json` (conflict markers) next to `good.json`, listing and both field callbacks still work for `good`. `bad` shows as unavailable. Doctor reports `bad.json` with its path and problem. No file is rewritten (`r07`).
- [ ] Bad JSON, conflict markers, an unsupported version, and an ID/path mismatch each produce a specific doctor finding. Stories linked to a corrupt Epic keep their links.
- [ ] An Epic file that a replacement creates or deletes in the same Story-create operation is seen by the guard. A stored read can't falsely accept a pending deletion or reject a pending creation (ARCH-30).
- [ ] A service-call spy shows one `stories.list` call per Epic-list load, regardless of how many Epics there are. Summary progress matches `showEpic` for open, closed, and all Epics, empty Epics, multiple Boards with distinct Stage categories, and Stories carrying bags from disabled or unknown plugins (PERF-01). Re-measure the loading expression from the [PERF-01 evidence](../../../reviews/plugin-architecture/other-areas.md#epic-listmts--historical-epic-list-loading-expression), report it in the PR, and add no CI timing threshold.
- [ ] Selecting an Epic Story opens its core detail, and Back returns to the Epic (ARCH-07).
- [ ] Clear, no-filter, and selected-Epic states work. Create with no selection emits no input.

## Findings

28 rows. Record final statuses in [findings.md](../findings.md#wp08a).

| Finding | Priority | Disposition | Issue | Required outcome |
| --- | --- | --- | --- | --- |
| [ARCH-07](../../../reviews/plugin-architecture/general-architecture.md#arch-07) | P2 | Recommended / see scope | Plugin screens cannot navigate to core records | Required. |
| [ARCH-30](../../../reviews/plugin-architecture/general-architecture.md#arch-30) | P2 | Recommended / see scope | Epic link guards read stored files rather than pending files | Required. |
| [CQ-16](../../../reviews/plugin-architecture/code-quality.md#cq-16) | See linked finding | Merged | Nested ternary inventory. | None separately — resolved by CQ-97, CQ-100, CQ-103, CQ-122, CQ-128. |
| [CQ-80](../../../reviews/plugin-architecture/code-quality.md#cq-80) | Optional | Optional; original diagnosis withdrawn | src/plugins/epics/index.ts:6/:12 parses EpicInput in transform and guard. Parsing once via caching is unsafe: guards validate the post-transform result/input contract and hooks … | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-81](../../../reviews/plugin-architecture/code-quality.md#cq-81) | P2 | Useful | src/plugins/epics/index.ts:48: epicOptions.slice(0, 1) depends on an implicit first-option invariant. Declare linkEpicOption and clearEpicOption and assemble lists by name. | Required. |
| [CQ-82](../../../reviews/plugin-architecture/code-quality.md#cq-82) | P2 | Useful | src/plugins/epics/index.ts:57: filter equality accepts unknown; malformed objects return no Stories instead of an invalid-filter error. Add a local/schema EpicFilter = z.union([… | Required. |
| [CQ-83](../../../reviews/plugin-architecture/code-quality.md#cq-83) | Optional | Optional | src/plugins/epics/index.ts:29: settings: z.object({}) differs from Specs/Comments' absent schema. Removing it is not behavior-neutral: an empty schema strips unknown settings; a… | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-84](../../../reviews/plugin-architecture/code-quality.md#cq-84) | Optional | Optional | src/plugins/epics/index.ts:64: severity: 'warning' as const provides legitimate literal narrowing through flatMap. Optionally annotate its callback (story): PluginFinding[] => .… | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-85](../../../reviews/plugin-architecture/code-quality.md#cq-85) | P2 | Useful | src/plugins/epics/model.ts:25: new ValidationError('Invalid Epic data', ...) lacks a field-level summary and labels Story input/patch errors as general Epic data. Include format… | Required. |
| [CQ-86](../../../reviews/plugin-architecture/code-quality.md#cq-86) | Optional | Optional | src/plugins/epics/service.ts:13, :35, :40, :52, :60, :82 and src/plugins/epics/index.ts:15/:66/:73 repeat ${id}.json; three writes repeat JSON serialization/newline. Optional pr… | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-87](../../../reviews/plugin-architecture/code-quality.md#cq-87) | Optional | Optional | src/plugins/epics/service.ts:50/:58: edit and close/reopen repeat get/patch/stamp/write. writeEpic under CQ-86 may be enough. Only if still useful, private changeEpic(plugin, op… | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-88](../../../reviews/plugin-architecture/code-quality.md#cq-88) | Optional | Optional | src/plugins/epics/service.ts:93/:98: mutable done accumulates inside Promise.all. This is not a JS race: each increment after await executes synchronously. Optional return each … | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-89](../../../reviews/plugin-architecture/code-quality.md#cq-89) | P2 | Useful | src/plugins/epics/EpicList.tsx:18 calls showEpic per result; src/plugins/epics/service.ts:90 rereads Epic, :91 calls epicStories, whose :70 lists all Stories each time; per-Epic… | Required. |
| [CQ-90](../../../reviews/plugin-architecture/code-quality.md#cq-90) | Optional | Optional | src/plugins/epics/service.ts:28 and src/plugins/specs/specs.ts:83: suffix removal uses slice(0, -5)/-3. Optional EPIC_FILE_EXTENSION = '.json' and local SPEC_FILE_EXTENSION = '.… | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-91](../../../reviews/plugin-architecture/code-quality.md#cq-91) | None | Withdrawn | src/plugins/epics/service.ts:22: validates ID then compares to the original ID. The schema has no trim/case transform, so the claimed normalized-versus-original mismatch does no… | None — withdrawn by the review. Do not implement the original prescription; any residual note in the package is optional. |
| [CQ-92](../../../reviews/plugin-architecture/code-quality.md#cq-92) | P2 | Useful | src/plugins/epics/service.ts:89: exported showEpic infers a substantial nested result. Name EpicProgress = { done: number; total: number; percent: number } and EpicSummary with … | Required. |
| [CQ-93](../../../reviews/plugin-architecture/code-quality.md#cq-93) | Optional | Optional | src/plugins/epics/commands.ts:4: DescriptionOptions includes name; rename EpicWriteOptions. Repeated setup at :29/:71 may use local withEpicWriteOptions(cmd: Command): Command a… | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-94](../../../reviews/plugin-architecture/code-quality.md#cq-94) | P2 | Useful | src/plugins/epics/commands.ts:77 reads Epic before checking “nothing to update” at :82. Correction: absence of flags does not open an editor. Move a raw presence check for name,… | Required. |
| [CQ-95](../../../reviews/plugin-architecture/code-quality.md#cq-95) | Optional | Optional | src/plugins/epics/commands.ts:87: two-command close/reopen registration loop is small/cohesive. Explicit registration is optional for discoverability; a higher-order registratio… | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-96](../../../reviews/plugin-architecture/code-quality.md#cq-96) | Optional | Optional | src/plugins/epics/tui.ts:21/:22/:27/:40/:45/:47: No Epic/All Epics encode selection states. Name private NO_EPIC = 'No Epic'/ALL_EPICS = 'All Epics' constants and use in default… | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-97](../../../reviews/plugin-architecture/code-quality.md#cq-97) | P2 | Useful | src/plugins/epics/tui.ts:26, :44, :46: nested ternaries convert selection to input/filter/summary. Replace with early returns in the same callbacks, retaining undefined for unch… | Required. |
| [CQ-98](../../../reviews/plugin-architecture/code-quality.md#cq-98) | None | Withdrawn | src/plugins/epics/tui.ts:6 and screens' PluginScreenProps<Record<string, unknown>> repeat a legitimate no-settings generic. An EpicSettings alias with no actual settings obscure… | None — withdrawn by the review. Do not implement the original prescription; any residual note in the package is optional. |
| [CQ-99](../../../reviews/plugin-architecture/code-quality.md#cq-99) | Optional | Optional | src/plugins/epics/EpicList.tsx:16/:18: async dependency on active reloads both leaving and returning; similarly detail. Comment why the mounted tab refreshes on activation. Shar… | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-100](../../../reviews/plugin-architecture/code-quality.md#cq-100) | Optional | Optional | src/plugins/epics/EpicList.tsx:30: ternary cycles open/closed/all. Optional private nextEpicMode(mode: 'open' \/ 'closed' \/ 'all') using a switch. An array/index/cast solution … | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-101](../../../reviews/plugin-architecture/code-quality.md#cq-101) | None | Withdrawn | src/plugins/epics/EpicDetail.tsx:46–:59 and src/plugins/specs/SpecDetailScreen.tsx:24–:35: a finally setter after ui.back() is normal cleanup; no warning/leak or behavioral fail… | None — withdrawn by the review. Do not implement the original prescription; any residual note in the package is optional. |
| [CQ-102](../../../reviews/plugin-architecture/code-quality.md#cq-102) | None | Withdrawn | src/plugins/epics/EpicForm.tsx:17 and src/plugins/specs/SpecFormScreen.tsx:17/:18: kind: 'text' as const preserves the literal type in an array spread; it is not an unsafe asser… | None — withdrawn by the review. Do not implement the original prescription; any residual note in the package is optional. |
| [PERF-01](../../../reviews/plugin-architecture/other-areas.md#perf-01) | P2 / scale gate | Conditional / decision | TUI Epic list loads all Stories once per Epic | Implement per the package / §9 decision; if the condition does not apply, `deferred: <condition>`. |
| [RES-12](../../../reviews/plugin-architecture/resiliency.md#res-12) | P1 | Recommended / see scope | A corrupt Epic blocks core form/filter loading and is invisible to doctor | Required. |
