# Panel

A Panel is a region of the screen with a `border-round` frame. Its title is set into the top edge (`╭─Board───╮`).

- The consumer provides `title`, `focused` and children. The Panel selects its colours. It uses `border` and an `ink-muted` title, or `accent` and a bold `accent` title when it is `focused`.
- Only one Panel is focused at a time. Do not pass a colour. The current `color` prop will be removed.
- The Panel has one column of padding inside (`col-1`). Never put a focused Panel in a different Panel.
