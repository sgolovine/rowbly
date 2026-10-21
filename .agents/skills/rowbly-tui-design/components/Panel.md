# Panel

A region of the screen, framed by `border-round` with its title set into the top edge (`╭─Board───╮`).

- The consumer provides `title`, `focused` and children. The Panel picks its colours: `border` and an `ink-muted` title, or `accent` and a bold `accent` title when `focused`.
- Exactly one Panel is focused at a time. Do not pass a colour: the current `color` prop goes away.
- One column of padding inside (`col-1`). Never nest a focused Panel inside another Panel.
