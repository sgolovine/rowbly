# ListRow

A ListRow is a row in the list view of the Board. It is a Stage heading or a Story.

- Do not use rules or blank rows. Each ListRow is one row of text. Because of this, a Story uses only one row, and the list shows two times as many Stories as it does now.
- Inside the row: there is one column (`col-1`) between the bar and the Story Key, and one column at the right edge. This gives the `selection` fill space on both sides.
- Stage heading: the heading shows `▾`/`▸` in `ink-faint`, the Stage NAME in `cell-title` and the count in `ink-faint`. Now, one heading shows the Stage Category, "Board", and not the Stage name "In Progress".
- Story row: the row shows the bar column, the Story Key in `accent` and the name in `ink`. Then it shows badges in `ink-muted` and the `StageBadge`, right-aligned.
- A Stage with no Stories shows `No Stories` in `ink-faint` below its heading.
