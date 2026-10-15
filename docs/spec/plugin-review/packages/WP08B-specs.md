# WP08B — Specs plugin

**Depends on:** WP02A, WP05A, WP05B, WP01B · **Wave:** 4 · **Priority:** P0 (preserving invalid link bags), P1 (UI-01 parity, error states, stale-link visibility), P2/optional for the rest
**Review sources:** [README WP08](../../../reviews/plugin-architecture/README.md#wp08); [ARCH-36](../../../reviews/plugin-architecture/general-architecture.md#arch-36) and [VER-02](../../../reviews/plugin-architecture/other-areas.md#ver-02) (Specs consumer part); [ARCH-25](../../../reviews/plugin-architecture/general-architecture.md#arch-25), [ARCH-42](../../../reviews/plugin-architecture/general-architecture.md#arch-42) (Specs result); [UI-01](../../../reviews/plugin-architecture/other-areas.md#ui-01); [PERF-02](../../../reviews/plugin-architecture/other-areas.md#perf-02), [PERF-08](../../../reviews/plugin-architecture/other-areas.md#perf-08), [PERF-09](../../../reviews/plugin-architecture/other-areas.md#perf-09); [DX-38](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-38); [CQ-19](../../../reviews/plugin-architecture/code-quality.md#cq-19); [CQ-103–123, CQ-166](../../../reviews/plugin-architecture/code-quality.md#cq-103).

## Goal

1. Incremental link edits never erase an invalid Specs bag (P0).
2. Spec targets and params are typed and validated, with draft creation kept working.
3. The TUI can force-delete an empty Board that holds Specs, as the CLI can.
4. Honest error states. Stale links are visible and removable.
5. Doctor and the controls read each file once.
6. Plugin-only changes stamp `updatedAt` consistently.

## Owns

- `src/plugins/specs/**`
- `src/tui/screens/boards/**`: the UI-01 force-delete flow only
- `test/plugins/specs*.test.ts(x)`, and the Board TUI and CLI force-deletion tests

## Deliverables

1. **ARCH-36 / VER-02 (P0).**
   - Additive and removal link mutations (`--add-spec`, `--remove-spec`, and unlink on delete) read the bag with `requireBag`. An invalid bag rejects with attributed `DATA_INTEGRITY` and saves nothing.
   - Full replacement (`--spec` / form multiselect) on an invalid bag requires an explicit, deliberate reset. Never treat it as an incremental edit.
   - Filtering treats an invalid bag as "unknown", not as "validated absence", and documents that.
2. **Targets (CQ-103, CQ-110, CQ-108, CQ-109).**
   - `SpecTarget` is the union `{ board; story; slug?: never } | { board; slug; story?: never }`. `listSpecs` returns `BoardSpec[]` with a required `slug`.
   - Separate the `SpecFormParams` branches: Board create (no slug yet), Story create, and edit with a complete target.
   - Validate external params with local schemas inside the async load or submit path. Remove every `as unknown as SpecTarget` and `slug as string`.
   - Keep the lowercase and uppercase key handling.
   - CQ-109: an explicit `'create' | 'edit'` mode, or `createSpec`/`updateSpec`.
   - CQ-110: keep the `resolveBoard` callback. It is not a defect.
   - CQ-108 (optional): a `specTargetName` helper.
3. **Errors (CQ-104, CQ-105, CQ-113).**
   - A local `parseSpecsInput` using `safeParse`, which throws `ValidationError` with issues. Under WP01B's policy, the CLI then returns `VALIDATION` with attribution.
   - Now that expected errors are preserved, you may share the set/add/remove incompatibility check (CQ-105). Keep CLI and API rejection with no writes.
   - CQ-113 (optional): a corrected comment.
4. **UI-01 / U4.**
   - The Specs Board-deletion guard returns `{ reject, hint, canForce: true }`, using the WP04A type and WP01B's pass-through.
   - The TUI Board deletion offers `{ force: true }` **only** when `canForce` is set, and only after confirming the removal of contained Stories and plugin files. The confirmation does not hard-code the Specs ID.
   - A non-forceable guard never gets a force option.
   - The CLI behavior is unchanged: exit 4 without `--force`, success with it.
5. **Error and empty states (CQ-118, CQ-117).**
   - Read failures render "Could not load Spec(s)."; pending reads render Loading; the no-Spec text appears only after a successful load finds nothing.
   - Edit, delete, and create shortcuts that depend on loaded data are disabled after a failure.
   - CQ-117: Board-selection states are `undefined` (initial, unresolved), `null` (chooser), and a string (selected). A stale initial resolution can't overwrite the user's choice. Do **not** use the rejected `chosen ?? default` design.
6. **CQ-166 / CQ-123.**
   - Story form options include currently linked but missing slugs, marked as missing if labels allow it, so they are visible and removable. New-Story and filter options never include missing slugs.
   - An empty **new** Story emits no input. An explicit dirty clear on an existing Story still emits a clear.
7. **Performance (PERF-02, PERF-08, PERF-09).**
   - The doctor check groups Stories by Board and resolves each distinct `(board, slug)` once, with a cache that lives only for the check pass.
   - Multi-slug filters read the bag once per Story.
   - `listSpecSlugs` serves the slug-only controls and the guard, with no document reads.
   - Keep the symlink and unreadable-file semantics consistent with WP02B's policy (W5).
8. **Timestamps (CQ-19, DX-38, W8).** Unlinking on Spec deletion and doctor fixes stamp `updatedAt`, using the operation clock, only when the bag actually changes.
9. **Other items:**
   - ARCH-42: own-operation result finalizer, so the command result is the final saved Spec.
   - ARCH-25: explicit titles (`New Spec`, `Edit <slug|KEY>`, and a meaningful detail title), with no inherited detail title in edit.
   - ARCH-26: consumer migration.
   - CQ-111: return the count from the body; keep `plugin.warn`.
   - CQ-107: a comment that untouched stale links are doctor's job; keep the create-guard coverage.
   - Optional: CQ-106, CQ-112, CQ-114, CQ-116 (with the CQ-164 docs handoff), CQ-119, CQ-121, CQ-122.
   - CQ-115: seed the editor once and never re-apply the title. Diagnostics name Specs' real `--file` flag.
   - Withdrawn: CQ-120.

## Acceptance criteria

- [ ] Additive and removal edits on an invalid Specs bag leave the raw bag unchanged and report an attributed error. Absent bags still accept additions. A guard rejection saves nothing (ARCH-36, VER-02).
- [ ] The Board create form opens before a slug is entered and creates successfully once one is. Edit and view require complete targets. Absent, both-set, or non-string targets give clear errors and no write (CQ-103).
- [ ] For an empty Board with a Spec: cancel preserves everything, and confirming force removes the Board and the Spec. A Board with Stories and Specs still works. A non-forceable plugin guard never offers force. The CLI exits 4 without force and succeeds with it. Error JSON keeps its attribution (UI-01).
- [ ] A read rejection renders a failure, never empty-state creation instructions. A failed detail view can't open edit or delete. A successful absent Story Spec still offers create (CQ-118).
- [ ] A Story linked to `gone` and to `auth` shows both and can remove `gone`. Opening the form stores nothing (CQ-166).
- [ ] With 5,000 Stories linking the same two files, doctor reads scale with distinct Boards and documents, not with link count. Two Boards with the same slug don't collide (PERF-02). Slug-only controls read no document content (PERF-09). One bag parse per Story per filter (PERF-08).
- [ ] Unlinking a Board Spec, and doctor repairs, advance the affected Stories' timestamps under a fixed later clock. Unaffected Stories are unchanged (CQ-19, DX-38).
- [ ] Editor seeding with `--title` works. A heading changed in the editor is saved unchanged (CQ-115).

## Findings

29 rows. Record final statuses in [findings.md](../findings.md#wp08b).

| Finding | Priority | Disposition | Issue | Required outcome |
| --- | --- | --- | --- | --- |
| [ARCH-25](../../../reviews/plugin-architecture/general-architecture.md#arch-25) | Optional | Optional / bounded | Specs routes have generic or inherited breadcrumb titles | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-19](../../../reviews/plugin-architecture/code-quality.md#cq-19) | P2 | Useful | Bag unlinking uses inconsistent modification timestamps. | Required. |
| [CQ-103](../../../reviews/plugin-architecture/code-quality.md#cq-103) | P1 | Recommended | The target and result types admit states the implementation cannot support. | Required. |
| [CQ-104](../../../reviews/plugin-architecture/code-quality.md#cq-104) | P2 | Useful | Raw Zod errors are inconsistent validation presentation, but the original exit-code claim was false. | Required. |
| [CQ-105](../../../reviews/plugin-architecture/code-quality.md#cq-105) | P2 | Useful / optional | src/plugins/specs/index.ts:80 and src/plugins/specs/specs.ts:146 duplicate the incompatible set/add/remove check. CLI checks currently preserve UsageError outside the wrapping b… | Required (optional sub-parts per entry). |
| [CQ-106](../../../reviews/plugin-architecture/code-quality.md#cq-106) | Optional | Optional | src/plugins/specs/index.ts:36/:56/:100 duplicate ${slug}.md from specs.ts:46; Story filename at :44. Optional local boardSpecFile(slug: string): string and STORY_SPEC_FILE = 'sp… | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-107](../../../reviews/plugin-architecture/code-quality.md#cq-107) | Optional | Optional; original diagnosis withdrawn | src/plugins/specs/index.ts:33 create guard scans every changed Story, while update at :49 checks the named Story and :52 checks requested/new links. Replacing the create loop wi… | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-108](../../../reviews/plugin-architecture/code-quality.md#cq-108) | Optional | Optional | src/plugins/specs/specs.ts:74/:103/:104/:123, commands.ts:46/:49/:65: repeated target.story ?? target.slug. After CQ-103, optionally introduce specTargetName(target: SpecTarget)… | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-109](../../../reviews/plugin-architecture/code-quality.md#cq-109) | P2 | Useful | src/plugins/specs/specs.ts:94: opaque final boolean in saveSpec(..., create), callers at commands.ts:62 and SpecFormScreen.tsx:23. Use an explicit mode 'create' \/ 'edit', or pu… | Required. |
| [CQ-110](../../../reviews/plugin-architecture/code-quality.md#cq-110) | Optional | Optional; original diagnosis withdrawn | src/plugins/specs/specs.ts:49 takes a narrow resolveBoard callback; this is useful decoupling, not a defect. Original proposal to pass PluginCommandEnv into service is withdrawn… | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-111](../../../reviews/plugin-architecture/code-quality.md#cq-111) | P2 | Useful | src/plugins/specs/specs.ts:120: outer let unlinked is mutated inside the operation. Return the local count from the body: const unlinked = await plugin.operation(..., async chan… | Required. |
| [CQ-112](../../../reviews/plugin-architecture/code-quality.md#cq-112) | Optional | Optional | src/plugins/specs/specs.ts:40: heading matcher repeated in test/replace; :34 intentionally captures title with a different pattern. Sharing the identical noncapturing regex is o… | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-113](../../../reviews/plugin-architecture/code-quality.md#cq-113) | Optional | Optional | src/plugins/specs/specs.ts:98: parent-resolution comment could explain validation order. Original rationale that body NotFoundError is automatically wrapped is false: src/servic… | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-114](../../../reviews/plugin-architecture/code-quality.md#cq-114) | Optional | Optional | src/plugins/specs/commands.ts:24–:70: four verbs share a branched action loop. Optional explicit show/delete actions and a small shared create/edit setup/read helper; retain coh… | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-115](../../../reviews/plugin-architecture/code-quality.md#cq-115) | P2 | Useful / optional | minor; U/O; C. Long-text glue is repeated, but the original proposed simplification would overwrite an editor's title. | Required (optional sub-parts per entry). |
| [CQ-116](../../../reviews/plugin-architecture/code-quality.md#cq-116) | Optional | Optional | src/plugins/specs/commands.ts:4: Options→SpecOptions; :29/:32/:33: placeholders <KEY>/<t>/<md> could be <key>/<title>/<text>. Uppercase KEY is not inherently wrong because it il… | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-117](../../../reviews/plugin-architecture/code-quality.md#cq-117) | P2 | Useful | Initial Board resolution and a user-requested chooser share the same undefined state. | Required. |
| [CQ-118](../../../reviews/plugin-architecture/code-quality.md#cq-118) | P1 | Recommended | Failure states are blank or falsely report absence. | Required. |
| [CQ-119](../../../reviews/plugin-architecture/code-quality.md#cq-119) | Optional | Optional | src/plugins/specs/SpecDetailScreen.tsx:10 and SpecTab.tsx:8: confirm holds boolean state. Optional rename state/setter confirming/setConfirming, matching Comments. | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-120](../../../reviews/plugin-architecture/code-quality.md#cq-120) | None | Withdrawn | src/plugins/specs/SpecTab.tsx:12: const linked = [] is an evolving array whose element type TypeScript infers from pushes at :14; it is not an escaped unchecked any[]. | None — withdrawn by the review. Do not implement the original prescription; any residual note in the package is optional. |
| [CQ-121](../../../reviews/plugin-architecture/code-quality.md#cq-121) | Optional | Optional | src/plugins/specs/SpecsScreen.tsx:48, SpecsSection.tsx:10, commands.ts:21: repeated ${s.slug}  ${s.title} within different separators. Optional plugin-local specLine(spec: Board… | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-122](../../../reviews/plugin-architecture/code-quality.md#cq-122) | Optional | Optional | src/plugins/specs/SpecText.tsx:25: - 1 reserves the status row at :38; name STATUS_ROWS = 1 or comment it. :30 duplicates normal j/k/arrow delta from public moveDelta; use it if… | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-123](../../../reviews/plugin-architecture/code-quality.md#cq-123) | P2 | Useful | src/plugins/specs/tui.ts:26: always emits { specs: [] } even for a new Story with no selection; unlike Epic input this needlessly transforms/guards. After dirty-field preservati… | Required. |
| [CQ-166](../../../reviews/plugin-architecture/code-quality.md#cq-166) | P1 | Recommended / useful | minor; P/U; C/I. A stale linked Spec can be selected but invisible in the form. New cross-check finding. | Required. |
| [DX-38](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-38) | P2 | Recommended / see scope | Plugin-owned record updates need an explicit timestamp convention | Required. |
| [PERF-02](../../../reviews/plugin-architecture/other-areas.md#perf-02) | P2 | Recommended / see scope | Specs doctor reads identical files once per Story link | Required. |
| [PERF-08](../../../reviews/plugin-architecture/other-areas.md#perf-08) | P2 | Recommended / see scope | Multi-Spec filtering reparses the bag per candidate slug | Required. |
| [PERF-09](../../../reviews/plugin-architecture/other-areas.md#perf-09) | P2 | Recommended / see scope | Slug-only Specs controls load complete documents | Required. |
| [UI-01](../../../reviews/plugin-architecture/other-areas.md#ui-01) | P1 | Recommended / see scope | Empty Boards with Specs have no TUI force-delete path | Required. |
