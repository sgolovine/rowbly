# WP08C — Comments plugin

**Depends on:** WP04A, WP01B, WP05B · **Wave:** 4 · **Priority:** P0 (preserving invalid Threads), P1/P2 for the rest
**Review sources:** [README WP08](../../../reviews/plugin-architecture/README.md#wp08); [ARCH-36](../../../reviews/plugin-architecture/general-architecture.md#arch-36) and [VER-02](../../../reviews/plugin-architecture/other-areas.md#ver-02) (Comments consumer part); [RES-11](../../../reviews/plugin-architecture/resiliency.md#res-11) (Comments reproduction in `crosscheck.ts`); [ARCH-42](../../../reviews/plugin-architecture/general-architecture.md#arch-42) (Comments finalizer); [UI-02](../../../reviews/plugin-architecture/other-areas.md#ui-02); [CQ-124–135](../../../reviews/plugin-architecture/code-quality.md#cq-124).

## Goal

1. Stop Comment mutations from replacing an invalid or unsupported Thread (P0).
2. Return final, post-transform Comment results.
3. Make CLI and TUI bodies identical.
4. Show honest error states and validate route params.
5. Apply the local cleanups.

## Owns

- `src/plugins/comments/**`
- `test/plugins/comments.test.ts`, `test/plugins/commentsCli.test.ts`, `test/plugins/commentsTui.test.tsx`, `test/plugins/relativeTime.test.ts`

## Deliverables

1. **ARCH-36 / VER-02 / RES-11 (P0).**
   - `addComment`, `editComment`, and `deleteComment` on a Story or Task read the Thread with `requireBag` (from WP04A).
   - An invalid Thread rejects with an attributed `DATA_INTEGRITY` error and saves nothing. "Invalid" includes the `crosscheck.ts` case: an old Comment with invalid timestamps plus a future field.
   - An absent Thread still accepts `add`.
   - Display reads stay tolerant, but **show** that the Thread is invalid ("Comments unavailable: stored Thread is invalid; run `rowbly doctor`"). Do not show it as empty.
   - Do not add an automatic repair. The explicit repair path is doctor (WP03 and the WP09B docs).
2. **ARCH-42 (Comments part).** Use WP01B's own-operation `result` finalizer. The returned Comment is the final one, after transforms, located by Story or Task and Comment ID in pending data. Callers and reactions receive the same value.
3. **UI-02 / W9.** The TUI passes raw body text to `addComment`/`editComment`; there is no `.trim()`. The service rejects whitespace-only bodies (CQ-125: a local `CommentBody` refine; never a `.trim()` transform). Bodies whose first line is indented, that have blank lines at the edges, or that are multiline Markdown are stored identically from the CLI and the TUI, for both Story and Task Comments.
4. **Error and empty states (CQ-131, CQ-132).** A rejected load renders "Could not load Comments." with no mutation hints. A successful empty Thread shows "No Comments yet" and offers add. Remove the hard-coded `c add · e edit · d delete` line; the existing dynamic hints remain.
5. **CQ-134.** `CommentFormScreen` validates a nonempty string `target` and an `id` that is absent or a string. It rejects a supplied non-string `id`, rather than treating it as create. Keep existing lowercase-key canonicalization. Do the validation in the async load/submit path, with no conditional hooks.
6. **Reload on return (ARCH-26 consumer).** If WP05B exported `useReloadOnReturn`, migrate `CommentsTab` off its `active` dependency where that preserves behavior (CQ-99 equivalence notes apply).
7. **Author resolution (ARCH-18, optional).** Keep the synchronous `plugin.me` with a per-mutation roster check. Never cache a resolved author for the lifetime of a context. Document a stale Me in the Docs handoff. Extract `currentAuthor()` only if it clearly helps.
8. **Local cleanups:**
   - CQ-126: drop unneeded `export`s.
   - CQ-127: add a `: Story` annotation and capture `taskId`. Coordinate with the CQ-165 helper typing from WP04A.
   - CQ-130: pass `current.body` directly.
   - CQ-133: un-export `CommentsTabProps`.
   - Optional: CQ-124 (only after (1); don't hide the invalid-Thread interpretation in a helper), CQ-128 (keep code-unit order; not `localeCompare`), CQ-129, CQ-135 comment.
   - CQ-167: withdrawn; there is no task.

## Acceptance criteria

- [ ] Malformed Story and Task Threads are unchanged after a rejected add, edit, or delete, including unknown fields. The error names the plugin and the path. An absent Thread still accepts add. A guard rejection saves nothing (ARCH-36, VER-02, RES-11).
- [ ] The TUI shows an invalid Thread as unavailable, not as empty.
- [ ] A transform that alters a new Comment's bag produces the same final Comment for the caller, the reaction, and disk (ARCH-42).
- [ ] CLI and TUI bodies with indentation, blank edges, and multiline Markdown are stored identically. Whitespace-only input rejects without changing the Thread (UI-02).
- [ ] A failed load shows a failure message with no mutation actions. An empty Thread offers only add (CQ-131, CQ-132).
- [ ] A missing or non-string target or ID shows a clear error, and no add or edit happens by accident (CQ-134).
- [ ] Disabled and unknown bags survive. CLI JSON results are unchanged unless intentionally pinned.

## Findings

15 rows. Record final statuses in [findings.md](../findings.md#wp08c).

| Finding | Priority | Disposition | Issue | Required outcome |
| --- | --- | --- | --- | --- |
| [ARCH-18](../../../reviews/plugin-architecture/general-architecture.md#arch-18) | Optional | Optional / bounded | Roster validation of Me is duplicated, but context-lifetime caching would be wrong | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-124](../../../reviews/plugin-architecture/code-quality.md#cq-124) | Optional | Optional | src/plugins/comments/comments.ts:38/:43/:64/:78: repeats commentsOn(plugin, owner.task ?? owner.story) and three owned lookups. Optional private threadOf(plugin: PluginContext, … | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-125](../../../reviews/plugin-architecture/code-quality.md#cq-125) | P2 | Useful / optional | src/plugins/comments/comments.ts:111: handwritten blank-body issues; model.ts:6's .min(1) accepts whitespace, while direct mutation rejects whitespace. Form/prompt validation do… | Required (optional sub-parts per entry). |
| [CQ-126](../../../reviews/plugin-architecture/code-quality.md#cq-126) | P2 | Useful | src/plugins/comments/comments.ts:14/:20/:26: Owner, ownerOf, ownerId have only same-module references; model.ts:3 CommentSchema is used only within model. Remove these export mo… | Required. |
| [CQ-127](../../../reviews/plugin-architecture/code-quality.md#cq-127) | P2 | Useful | src/plugins/comments/comments.ts:87: updateThread lacks a declared Story result; :94 repeats owner.task?.id despite the preceding guard. Annotate : Story, capture const taskId =… | Required. |
| [CQ-128](../../../reviews/plugin-architecture/code-quality.md#cq-128) | Optional | Optional | src/plugins/comments/comments.ts:120: small code-unit comparator ternary is clear. Use CQ-20 helper only if chosen; localeCompare is not an equivalent substitution. | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-129](../../../reviews/plugin-architecture/code-quality.md#cq-129) | Optional | Optional | src/plugins/comments/commands.ts:71/:72, CommentsTab.tsx:90/:94/:106: repeats author fallback and edited marker. Optional isCommentEdited(comment: Comment): boolean and commentA… | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-130](../../../reviews/plugin-architecture/code-quality.md#cq-130) | P2 | Useful | src/plugins/comments/commands.ts:37: opts.edit ? current.body : undefined repeats the reader's edit-only use of initial text. Pass current.body directly. | Required. |
| [CQ-131](../../../reviews/plugin-architecture/code-quality.md#cq-131) | P1 | Recommended | src/plugins/comments/CommentsTab.tsx:76: failure renders red “No Comments.” while true empty state at :82 is separate. Change to “Could not load Comments.” useAsync already toas… | Required. |
| [CQ-132](../../../reviews/plugin-architecture/code-quality.md#cq-132) | P2 | Useful | src/plugins/comments/CommentsTab.tsx:103: unconditional c add · e edit · d delete duplicates footer :35–:48 and advertises edit/delete on an empty thread/while confirming. Delet… | Required. |
| [CQ-133](../../../reviews/plugin-architecture/code-quality.md#cq-133) | P2 | Useful | src/plugins/comments/CommentsTab.tsx:17: CommentsTabProps has no outside consumer. Remove export; keep component exported. | Required. |
| [CQ-134](../../../reviews/plugin-architecture/code-quality.md#cq-134) | P2 | Useful | src/plugins/comments/CommentFormScreen.tsx:7/:8: String(params.target ?? '') and params.id as string \/ undefined turn malformed navigation into bad IDs or wrong mode. Validate … | Required. |
| [CQ-135](../../../reviews/plugin-architecture/code-quality.md#cq-135) | Optional | Optional | src/plugins/comments/relativeTime.ts:2/:3: year/month use fixed 365/30 days. Add “Months and years are approximate elapsed-time units.” No calendar library necessary. | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-167](../../../reviews/plugin-architecture/code-quality.md#cq-167) | None | Withdrawn | Unsupported draft reference; withdrawn. No source finding or implementation task. | None — withdrawn by the review. Do not implement the original prescription; any residual note in the package is optional. |
| [UI-02](../../../reviews/plugin-architecture/other-areas.md#ui-02) | P2 | Recommended / see scope | TUI Comments trim content that CLI preserves | Required. |
