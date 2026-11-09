# Header

The Header is one Panel across the top of the screen. It is three rows tall, and it has no title in its top edge.

- Far left: the Data Root Button, then a `|`. The Data Root Button is a quiet Button with the key `D`.
  It shows the name of the open Data Root. This name is the label of the Data Root in the Home Config.
  If there is no label, the name is `Global` or the name of its folder. Rowbly cuts the name at 24
  columns with `…`.

  The Data Root Button opens the Data Root switcher. This is a generic Modal with the title
  `Data Roots`. It has one row for each known Data Root. Each row shows the name of the Data Root.
  Then it shows the applicable tags: `· current` in `accent`, `· default` in `ink-muted` and
  `· missing` in `danger`. Below the name, the row shows the path in `ink-faint`, cut from the start.
  The last row is **+ New Data Root**, with the key `n`.
- Left: after the Data Root Button, the state of the Board is in `ink-muted`. The state tells if the Stages are scrolled, if the Board is view-only, and which filter is on, if there is one. The Header never shows the name of the Board.
- Right: `me` and the name of Me in `ink-faint`, then the header Buttons on the same row. The Buttons are, in this sequence: Plugin Sidebars, Settings, the Plugin Actions in focus, ViewSwitch, and the primary **+ New Story** last. A Plugin Action that is in progress shows as busy, for example `Sync…`. A `|` in `border-control` separates each Button from the next. The key caps show the keys.
- The Panel never gets the focus, because it has no keys. As a result, its frame stays `border`.
- If the row is too narrow, remove the keys of the Buttons first. Then remove the quiet Buttons. Their keys continue to work, and Help shows them. **+ New Story** and the Data Root Button always stay.
