# Toast

A Toast is a short message at the bottom right of the screen after an Operation. It disappears automatically after a set time (info 4 s, warning 6 s, error 8 s).

- No frame: The Toast has an `overlay-raised` fill from edge to edge, so it also shows over a Modal. There is one blank fill row above and below the message, and two spaces on each side.
- Glyph in the colour of the kind: Info has an `accent` `✓`, warning has a `stage-board` `!` and error has a `danger` `✕`. The message is in `ink`.
- The message is one sentence with no full stop, and it gives the name of the record (`Moved ROW-9 to Done`). An error adds the hint from its `RowblyError`.
