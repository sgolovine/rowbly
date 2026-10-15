# WP05C — Combined Story/Task edit operation

**Depends on:** WP02C, WP05A · **Wave:** 4 · **Priority:** P0
**Review sources:** [ARCH-43](../../../reviews/plugin-architecture/general-architecture.md#arch-43); [CQ-69](../../../reviews/plugin-architecture/code-quality.md#cq-69); [README WP05 core-service ownership](../../../reviews/plugin-architecture/README.md#wp05).

## Goal

Today a Story or Task form submission that edits fields **and** changes Stage runs `update`, then `move`. That is two operations: the update can save and react before a move guard rejects. Make the submission one service operation, so the user action commits or rejects as a whole (ADR-0012's "one user action = one Change Set").

## Owns

- `src/services/stories.ts`, `src/services/tasks.ts`: the `update` paths and the Stage/rank calculation
- new `src/services/stageValidation.ts` (CQ-69)
- `src/tui/screens/stories/StoryFormScreen.tsx`, `src/tui/screens/tasks/TaskFormScreen.tsx`: the submission call only
- new `test/services/combinedEdit.test.ts`, plus the TUI form tests for this behavior

## Type change (CCR pre-approved)

Add `stage?: Slug` to `StoryPatch` and `TaskPatch` in `src/services/types.ts`, and adjust the `stories.update` / `tasks.update` operation input types to match. WP04A owns these files but has merged by now, so this specific edit is approved. List it in the PR.

## Deliverables

1. **ARCH-43.** `stories.update` and `tasks.update` accept an optional `stage`.
   - If the Stage changes: validate it with the existing rules and allocate a destination rank at the bottom of the target Stage, the same as `move`.
   - If the Stage is unchanged: preserve the rank.
   - Refactor the pure move and rank calculation locally. **Do not** call the public `move` operation from inside `update` (WP01A rejects that anyway).
2. **The forms** submit one `update` that carries both the field edits and the Stage.
3. **Hook intent.** Hooks that care about Stage transitions inspect the before/after changes in `stories.update` as well as `stories.move`. Add this to the Docs handoff, and check that no built-in hook depends on `move` alone for Stage-transition logic.
4. **CLI.** `stories move` and `tasks move` stay. Exposing `--stage` on `edit` is optional. If you add it, coordinate the command-file edit through a CCR, because WP04B or WP06 may own `src/commands/**`.
5. **CQ-69.** Extract the identical `checkStage(config, stageId)` into `src/services/stageValidation.ts`, keeping the same signature and errors.

## Acceptance criteria

- [ ] A Stage-transition guard that rejects (fixture) prevents the title, plugin bags, **and** the Stage from changing for a form submission.
- [ ] A successful edit with a Stage change saves once and reacts once.
- [ ] An unchanged Stage preserves the rank. Moving through edit appends to the bottom of the destination Stage, matching `move`.
- [ ] CLI `move` and TUI edit produce the same persisted Stage and rank for equivalent inputs.
- [ ] Missing, unknown, and `null` Stage validation errors are unchanged (CQ-69).

## Findings

2 rows. Record final statuses in [findings.md](../findings.md#wp05c).

| Finding | Priority | Disposition | Issue | Required outcome |
| --- | --- | --- | --- | --- |
| [ARCH-43](../../../reviews/plugin-architecture/general-architecture.md#arch-43) | P0 | Recommended / see scope | One TUI edit submission can commit twice and partially succeed | Required. |
| [CQ-69](../../../reviews/plugin-architecture/code-quality.md#cq-69) | Optional | Optional | src/services/stories.ts:352 and src/services/tasks.ts:105: identical checkStage(config, stageId) validation. Optional extract with unchanged signature into src/services/stageVal… | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
