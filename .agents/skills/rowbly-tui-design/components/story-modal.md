# StoryModal

> **Note:** The current shell does not use a StoryModal. The new Story form and the edit form of a
> Story show in the Story sidebar, a `Panel` on the right of the Story list. See the "Story sidebar"
> section of `docs/architecture/tui.md`. This guideline is the v1 pattern.

StoryModal is a screen Modal that shows one Story. The `enter` key opens it from the Board or the list view. It is a screen in a frame, not a task.

- **Fixed size**: The size is one column and one row smaller on each side than the area of the Board panel. The maximum width is 120 columns. The size never changes between Tabs, so the frame does not jump when the user goes from Details to Comments.
- **Header band** on `overlay-raised`: The band is always visible, on all Tabs.
  - Row 1: The Story Key is in `accent`, then two columns, then the name in `cell-title`. The name is cut with `…` and never wraps.
  - Row 2: The summary line has `·` between its items. It shows `StageBadge`, Priority and Plugin badges in `ink-muted`, then `updated <relative time>` in `ink-faint`. The line does not show a value that is not set. It does not show `—` in its place.
  - Then there is one blank row, and then the `Tabs`. Details is first, then one Tab for each Plugin, in Plugin order. Each Tab can have a count.
- **Body**: The body shows the content of the selected Tab, with `col-2` padding. The body scrolls, but the band and the hints do not move.
- **Specs Tab**: The Modal uses `flush`, and the Tabs and the General Tab have their own padding. The Specs Tab has two `Panel`s that go to the edges of the Modal frame, with one column between them. The left `Panel` is the list, with the title `Specs`. The right `Panel` is the text of the spec, with the title of the spec. The `Panel` in focus has an `accent` frame, and the other `Panel` has a `border` frame. The `tab` key or a click in a `Panel` moves the focus to the `Panel`. The `shift+tab` key changes the Tab of the Modal.
- **Keys**: The `KeyHints` strip shows the keys for the Tab in focus (`tab switch tab`, `e edit`, `m move Stage`, `d delete`, `esc back`).
- The title in the frame is `Board › ROW-9`. A generic Modal that opens from StoryModal (edit, Move Stage, delete) goes on top and takes the focus.
- Plugins add Tabs and badges. They do not change the band.
