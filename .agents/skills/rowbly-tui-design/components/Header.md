# Header

One Panel across the top, three rows tall, with no title in its top edge.

- Far left: the Data Root Button, a quiet Button naming the open Data Root (its label in the Home
  Config, else `Global` or its folder; cut at 24 columns with `…`) with key `D`, then a `|`. It opens the
  Data Root switcher: a generic Modal titled `Data Roots`, one row per known Data Root (its name, then
  `· current` in `accent`, `· default` in `ink-muted`, `· missing` in `danger`, and its path below in
  `ink-faint`, cut from the start), then a last row **+ New Data Root** with key `n`.
- Left: the Board name in `cell-title`, then any filter as `filter` (`ink-faint`) + its value (`ink`).
- Right: `me` and Me's name in `ink-faint`, then the header Buttons on the same row: Plugin Sidebars, Settings, ViewSwitch, then the primary **+ New Story** last, each separated by a `|` in `border-control`. Keys show in key caps.
- The Panel is never focused (it has no keys), so its frame stays `border`.
- When the row is too narrow, drop the Buttons' keys first, then the quiet Buttons (their keys still work and are in Help); **+ New Story** and the Data Root Button stay.
