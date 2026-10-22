# ContextMenu

A framed list of items opened by a right click, at the cell under the pointer. It is drawn over
everything, Modals and sidebars included, and moved in from the edges so it stays fully on screen.

- `border-round` frame in `accent` (it has the focus), `overlay` fill, no title, no `✕`, no hint strip.
  The footer shows its keys instead: `↑/↓ select`, `enter run`, `esc close`.
- One row per item: the label in `ink`, sentence case with the domain nouns in Title Case
  (`Move to next Stage`), and the key that does the same on the screen right-aligned in `ink-muted`.
- The highlighted item looks like any selected row: the `▌` bar in `accent`, the `selection` fill and
  the label bold. It opens on the first item; hovering an item highlights it.
- An item that does not apply is shown in `ink-faint` and skipped by the cursor; a click on it does
  nothing.
- `↑/↓` (or `j/k`) move, `enter` or a click runs the item and closes the menu, `esc` closes it. A
  click or right click outside the menu only closes it; it does not reach the box underneath.
- Offer only what the screen's keys already do. Open it from a screen with `useContextMenu()`.
