# SidebarList

The rows of a sidebar: Boards, the Epics Plugin Sidebar, the settings sections.

- The consumer provides the rows, the highlighted index and whether the sidebar is in focus.
- Highlighted row: `▌` in `accent`, `selection` fill, name in `cell-title`. When the sidebar is not in focus the fill goes and the bar is `ink-faint`.
- A Board's number key sits right-aligned in `ink-faint`.
- The foot holds a quiet `Button`, `+ New <noun>` with its key in a key cap (`+ New Board [N]`). Section headings in a grouped list (Global, Board: Rowbly) are `ink-faint`, not bold.
