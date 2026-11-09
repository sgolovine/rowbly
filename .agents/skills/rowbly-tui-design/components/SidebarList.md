# SidebarList

SidebarList shows the rows of a sidebar. Boards, the Epics Plugin Sidebar and the settings sections use it.

- The consumer provides the rows, the highlighted index and the focus state of the sidebar.
- Highlighted row: The row has a `▌` in `accent`, the `selection` fill and the name in `cell-title`. It keeps the bar and fill when the sidebar is not in focus.
- The number key of a Board is right-aligned, in `ink-faint`.
- The bottom of the list has a quiet `Button`, `+ New <noun>`, with its key in a key cap (`+ New Board [N]`). In a grouped list, the section headings (Global, Board: Rowbly) are `ink-faint`, not bold.
- An editable row shows a `✎` at its right edge, in `ink-faint`. On the highlighted row, the `✎` is `ink-muted`. A click on the `✎` edits the row. The `e` key does the same operation on the highlighted row while the sidebar is in focus.
- A movable row moves up or down its list. Drag the row with the mouse, and drop it on a different row. While you drag, the row below the pointer shows a `›` in `accent`. When the sidebar is in focus, `shift+↑/↓` (or `K`/`J`) moves the highlighted row. The Stage sidebar uses this to set the board order of the Stages.
- If the height is too small for all rows, the sidebar shows the rows around the highlighted row. `↑ 3 more` and `↓ 2 more` in `ink-faint` show the number of rows that are not visible. The mouse wheel selects a different row.
- In a narrow terminal, the Stage sidebar goes above the Story list and has the full width of the terminal. Its right edge does not drag in this layout. A narrow terminal that is also short keeps the sidebar next to the list.
