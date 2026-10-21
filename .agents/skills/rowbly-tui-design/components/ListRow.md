# ListRow

A row of the Board's list view: a Stage heading or a Story.

- No rules and no blank rows: each row is one row of text, so a Story costs one row and the list fits twice as many as today.
- Inside the row: one column (`col-1`) between the bar and the Story Key, and one at the right edge, so the `selection` fill has room on both sides.
- Stage heading: `▾`/`▸` in `ink-faint`, the Stage NAME in `cell-title` (today one heading shows the Stage Category, "Board", instead of the Stage name "In Progress"), the count in `ink-faint`.
- Story row: the bar column, the Story Key in `accent`, the name in `ink`, then badges in `ink-muted` and the `StageBadge` right-aligned.
- A Stage with no Stories shows `No Stories` in `ink-faint` under its heading.
