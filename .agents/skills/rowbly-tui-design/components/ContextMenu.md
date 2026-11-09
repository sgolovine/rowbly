# ContextMenu

A ContextMenu is a list of items in a frame. A right click opens it at the cell below the pointer.
Rowbly renders it above all other content on the screen. Rowbly moves it in from the edges so that
all of the menu stays on the screen. It opens only from the active screen. When a Modal or another
overlay covers the screen, a right click does nothing.

- The menu has a `border-round` frame in `accent`, because it has the focus. It has an `overlay` fill.
  It has no title, no `✕` and no hint strip. The footer shows its keys instead: `↑/↓ select`,
  `enter run`, `esc close`.
- Each item has one row. The label is in `ink`, in sentence case, with the domain nouns in Title Case
  (`Move to next Stage`). The row also shows the key that does the same action on the screen. This
  key is right-aligned, in `ink-muted`.
- The highlighted item looks the same as all other selected rows. It has the `▌` bar in `accent`, the
  `selection` fill and a bold label. When the menu opens, the first item is highlighted. When the
  mouse pointer is on an item, that item is highlighted.
- The menu shows an item that does not apply in `ink-faint`. The cursor moves past this item. A click
  on it does nothing.
- `↑/↓` (or `j/k`) move the cursor. `enter` or a click runs the item and closes the menu. `esc` closes
  the menu. A click or a right click outside the menu only closes the menu. The click does not go to
  the box below the menu.
- In the menu, put only the actions that the keys of the screen already do.
- A right click first selects the row below the pointer (a Story, a Board or a `SelectList` item).
  This makes sure that the menu and the keys of the screen apply to the same record. When an item
  runs, it makes sure that the record is still the selected record. A Board or Plugin entry in a
  sidebar is the exception. The menu applies to that entry, but it does not change the Board in
  context or the Plugin filter.
- Where it opens: a ContextMenu opens on a Story on the board and on its line in the list view. It
  also opens on a Board in the Boards list and in the Board sidebar. It also opens on an Epic in the
  Epics list or in the sidebar.
