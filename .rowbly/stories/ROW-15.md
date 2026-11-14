---
title: items should be selectable in factory issues view
stage: IN_DEVELOPMENT
position: 1
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-15
pull_request: null
---

## Goal

In the Factory controls, a click on a warning row opens the warning at once. A user cannot see which row they will open, and one wrong click opens a detail view. The rows of the Story list work in a different way: the first click selects a row, and a second click on the selected row opens it. The warning rows must work like the Story rows.

Original request from the author: "Items should be selectable like stories are. First click should highlight it. Second click opens it." The attached screenshot shows the `Attention` list of the Factory Modal main view.

## Scope

In scope:

- The `Attention` list in the main view of the Factory Modal (`FactoryOverview`, `FactoryList`, `FactoryListItem`).
  - The first click on a row that is not selected selects that row and shows the selection bar and fill, as `SelectionRow` shows for a Story row.
  - A click on the selected row opens the detail view of that warning (the current `onProblem` / `attention.actions.pick`).
  - A click on a different row moves the selection to that row. It does not open a warning.
- The list of the `Warnings` view (`FactoryAttention`, which uses `SelectList`).
  - The same two-click behaviour for a mouse click. `enter` on the highlighted row continues to open the warning.
- Update the tests and `docs/architecture/tui.md` (the text about a click on an `Attention` row).

Not in scope:

- Keyboard navigation of the `Attention` list in the main view. The main view keys (`enter` opens the supervisor, `w`, `h`, `a`, `x`) do not change.
- A change of the click behaviour of other `SelectList` users (pickers, settings lists).
- The `Queue` list. Its rows have no action.

## Acceptance criteria

- [ ] In the Factory Modal main view, one click on an `Attention` row selects the row (the row shows the `▌` selection bar) and does not open the detail view. A component test examines this.
- [ ] A second click on the selected `Attention` row opens the detail view of that warning. A component test examines this.
- [ ] After a click on row A, a click on row B selects row B and does not open a warning. A component test examines this.
- [ ] In the `Warnings` view, one click on a row that is not highlighted highlights it and does not open the detail view. A click on the highlighted row opens the detail view. A component test examines this.
- [ ] In the `Warnings` view, `enter` continues to open the highlighted warning. The existing test continues to pass.
- [ ] Other `SelectList` users keep the current one-click pick. The existing `select-list` tests continue to pass without changes.
- [ ] If the selected warning goes away from the status, no row stays selected and no error occurs. A test examines this.
- [ ] While `clickable` is false (a dialog or a different view has the keys), a click does not select and does not open a row. The existing test continues to pass.
- [ ] `docs/architecture/tui.md` tells the new click behaviour of the warning rows, in STE.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- Story list reference: `src/tui/screens/stories/story-list/story-list-drag.ts` `clickRow()` calls `onActivate` when the clicked index is the cursor, and else calls `onCursor`. `StoryRow` uses `SelectionRow` from `src/tui/components/selection-row/`.
- Main view: `src/tui/screens/factory/factory-overview/factory-overview.tsx` builds the `Attention` rows for `FactoryList` (`src/tui/screens/factory/factory-list/factory-list.tsx`), and each row is a `FactoryListItem` (`factory-list-item.tsx`) that uses `useMouse` directly. Add a selected key state (for example in `FactoryOverview` or in `useFactoryAttention`), and render a selected row with `SelectionRow` (or the same bar and `theme.selection` fill). Keep the colours in `theme`.
- `FactoryMain` passes `onProblem={attention.actions.pick}` and `clickable={idle}`. Keep `pick` as the open action.
- Warnings view: `src/tui/screens/factory/factory-attention/factory-attention.tsx` uses `SelectList`. In single mode, `SelectList` calls `pickItem()` (`src/tui/components/select-list/use-select-list.ts`) on each click, which moves the cursor and calls `onSelect`. Add an opt-in prop to `SelectListProps` (`select-list-types.ts`), for example `clickToHighlight?: boolean`, with the default `false`. When it is `true`, a click on a row that is not highlighted only calls `env.setCursor(at)`. Set the prop in `FactoryAttention`.
- Tests to update: `factory-overview.test.tsx` ("opens a warning with a click on its row"), `factory-main.test.tsx`, `factory-list.test.tsx`, `factory-list-item.test.tsx`, `factory-attention.test.tsx`, `factory-modal.test.tsx` (the tests that use `tui.click("Canonical commit: failed")` now need two clicks), and `select-list` tests for the new prop.
- Read the `rowbly-tui-design` and `rowbly-code-style` skills before the change. No service changes are necessary.

## Assumptions

- "Factory issues view" is the `Attention` list of the Factory Modal main view and the `Warnings` view list. Reason: the screenshot shows the `Attention` list, and the `Warnings` view shows the same warnings with the same one-click open.
- The `Attention` list in the main view gets no keyboard navigation. Reason: the request is about clicks, and the main view keys (`enter` for the supervisor) would conflict. Smallest scope.
- The two-click behaviour in `SelectList` is opt-in. Reason: other pickers must keep their current behaviour; the request is only about the factory warnings.
- No row is selected when the Factory Modal opens. Reason: the Story list starts with a cursor, but the main view has no keyboard focus on the list, so a first selection would have no use.
