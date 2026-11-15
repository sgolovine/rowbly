---
title: Fix Gap in list view.
stage: IN_DEVELOPMENT
position: 1
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-68
pull_request: null
---

## Goal

In the TUI Story list, a blank line shows at the top of the list, below the Panel title. This occurs only when the list has more rows than the Panel height (for example, when the `Done` section is expanded and has many Stories) and the list shows its first row. The screenshots of the Story show the gap above `Backlog` when `Done` is expanded, and no gap when `Done` is collapsed.

The cause is in `src/tui/screens/stories/story-list/`. When the list overflows, `StoryList` always shows a line for `↑ n more` and a line for `↓ n more`. When there are no rows above (or below), it shows `" "` on that line, and `listWindow` always keeps 2 lines for these indicators (`limit = height - 2`).

The result for the user: the list starts directly below the Panel title, with no blank line, and the list uses that line to show one more row.

## Scope

In scope:

- The Story list of the board (`StoryList` and `listWindow` in `src/tui/screens/stories/story-list/`).
- Show the `↑ n more` line only when rows are above the window. Show the `↓ n more` line only when rows are below the window. Do not show a blank placeholder line in their place.
- Give the free lines to Story rows, so that the list fills the full `height`.

Not in scope:

- The sidebar (`src/tui/components/sidebar/sidebar.tsx`). It has the same blank placeholder line on purpose. It does not change in this Story.
- The Factory list, the Threads view and other lists.
- Changes to the Panel, the shell frame or the height calculation in `shell-frame.ts` / `shell-props.ts`.

## Acceptance criteria

- [ ] `listWindow(count, height, cursor, slot)` with `count > height` and the cursor near the top (`start === 0`) gives `above === 0`, and the rows shown plus the `↓ n more` line use exactly `height` lines (`shown === height - 1`).
- [ ] With the cursor near the end (`start + shown === count`), `below === 0` and `shown === height - 1` (only the `↑ n more` line).
- [ ] With the cursor in the middle, both indicator lines show and `shown === height - 2`, as now.
- [ ] When the list does not overflow (`count <= height` or `height === undefined`), the result is the same as now.
- [ ] During a drag, the drop gap (`slot` in the window) still takes one line, and the total of rows, gap and indicator lines is not more than `height`.
- [ ] `StoryList` renders the `↑ n more` line only when `view.above > 0` and the `↓ n more` line only when `view.below > 0`. It renders no `" "` placeholder line.
- [ ] A person examines the TUI in a real terminal (the `rowbly-screenshots` skill): with the `Done` section expanded and more Stories than the Panel height, the first Stage heading is directly below the Panel title. Moving the cursor down and up with the keys and the mouse wheel scrolls the list, and the cursor row is always visible.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- `src/tui/screens/stories/story-list/story-list-window.ts`: `listWindow` now sets `limit = Math.max(1, height - 2)` when the list overflows. Change it so that the number of indicator lines depends on the window position. A possible method:
  1. Compute `start` with one indicator line (`limit = height - 1`), centred on the cursor as now.
  2. If `start === 0`, keep `height - 1` rows (only the `↓` line).
  3. Else, if `start + (height - 1) >= count`, use `start = count - (height - 1)` (only the `↑` line).
  4. Else, use `limit = height - 2` and compute `start` again (both lines).
  Keep a minimum of 1 row for very small heights. Keep the existing rule for the drop gap: when `slot` is in the window, the last row leaves (`shown = limit - 1`).
- `src/tui/screens/stories/story-list/story-list.tsx`: change the two `view.overflow && …` lines to render only when `view.above > 0` / `view.below > 0`. Update the TSDoc of `StoryList` and the comment in `listWindow` so that they agree with the new behaviour.
- `wheelCursor` and `useMouse` in `story-list-drag.ts` use `view.overflow`. They do not change.
- `story-list-window.ts` is a pure function, but it is in `src/tui/`. The testing rules say: do not put a test in `src/tui/` (docs/architecture/testing.md). Do not add a test file. Examine the behaviour in a real terminal.
- Read `.agents/skills/rowbly-tui-design/SKILL.md` and `.agents/skills/rowbly-code-style/SKILL.md` before the change.

## Assumptions

- The bottom `↓ n more` placeholder gets the same change as the top one. Reason: it is the same blank line in the same component, and one rule for both lines is simpler. The author reported only the top gap, which is the most visible case.
- The sidebar keeps its blank placeholder lines. Reason: the author reported only the list view, and the sidebar comment says that the blank line is on purpose. This is the smallest scope.
- The list can move by one line when the `↑ n more` line appears or goes. Reason: this is the expected result of removing the blank line, and the cursor row stays visible.
- No automated test is added. Reason: the repository rules do not allow tests in `src/tui/`.
