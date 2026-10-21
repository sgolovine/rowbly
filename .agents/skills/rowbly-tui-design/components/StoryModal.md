# StoryModal

A screen Modal: one Story, opened with `enter` from the Board or the list view. It is a screen in a frame, not a task.

- **Fixed size**: the Board panel's area less one column and one row on each side, at most 120 columns. It never changes size between Tabs, so switching from Details to Comments does not make the frame jump.
- **Header band** on `overlay-raised`, always visible whatever the Tab:
  - row 1: the Story Key in `accent`, two columns, the name in `cell-title` (cut with `…`, never wrapped);
  - row 2: the summary line, `·`-separated: `StageBadge`, Priority and Plugin badges in `ink-muted`, then `updated <relative time>` in `ink-faint`. A missing value is left out, not shown as `—`;
  - one blank row, then the `Tabs`: Details first, then a Tab per Plugin in Plugin order, each with an optional count.
- **Body**: the selected Tab's content with `col-2` padding; it scrolls on its own, the band and hints stay put.
- **Keys**: the `KeyHints` strip for the Tab in focus (`tab switch tab`, `e edit`, `m move Stage`, `d delete`, `esc back`).
- Title in the frame: `Board › ROW-9`. A generic Modal opened from it (edit, Move Stage, delete) stacks on top and takes the focus.
- Plugins add Tabs and badges; they do not change the band.
