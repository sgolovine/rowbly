# WP09 — Kanban Board View

**Depends on:** WP05 · **Phase:** 3 · **Ends at Checkpoint B**

## Goal

Build the centrepiece of the TUI: a Kanban board with one column per Stage. It becomes the default home screen when a board is in context.

## Owns

`src/tui/screens/board/**`, the README section `tui`, and tests. WP09 may also change the `home` entry in `src/tui/screens/index.ts` so that the board view is the default route when a board resolves. The change is one line, and the supervisor must be told about it.

## Behaviour

- **Columns** follow the effective stage order. Each header shows the stage name, its category colour and a story count. Cards are sorted by rank and show the key, a truncated name, priority, assignee handles and the task summary.
- **Navigation**:
  - `h`/`l` or ←/→ moves between columns, and `j`/`k` or ↑/↓ moves between cards;
  - when there are more columns than fit the width, the view scrolls horizontally and shows column indicators;
  - when a column has more cards than fit, the column scrolls vertically.
- **Actions on the selected card**:
  - `enter` opens the story detail screen (WP05);
  - `H`/`L` (shift) moves the story to the previous or next stage, at the bottom of that stage (`services.stories.move`);
  - `K`/`J` (shift) moves it up or down within its column (`services.stories.rank`);
  - `n` creates a story in the current column (story form with the stage preset);
  - `e` edits the story;
  - `d` deletes it after confirmation;
  - `/` filters the cards (by assignee, `me`, label, priority, epic or text);
  - `b` opens the board switcher.
- **Writes** update the display immediately and are then confirmed by the service. If the service throws, the move is reverted and a toast is shown.
- **Refresh**: `r` reloads. The view also reloads when the screen regains focus after an edit.

## Acceptance criteria

- [ ] `ink-testing-library` tests on a fixture board with 4 stages and 6 stories cover:
  - the column render;
  - moving a card right with `L`, after which the story's stage changes on disk;
  - reordering with `K`, after which only one file changes;
  - the filter narrowing the cards;
  - a forced service error reverting the move and showing a toast.
- [ ] A width of 80 columns with 6 stages scrolls horizontally without wrapping cards.
- [ ] With a board in context, `rowbly` opens straight to the board view. Without one, it opens the home menu.
- [ ] Attach screenshots or snapshots to the PR for Checkpoint B.
