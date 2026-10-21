# Toast

A short message bottom-right after an Operation, that goes away on its own (info 4 s, warning 6 s, error 8 s).

- No frame: an `overlay-raised` fill (so it shows over a Modal too) that runs edge to edge, one blank fill row above and below the message and two spaces each side.
- Glyph in the kind's colour: info `accent` `✓`, warning `stage-board` `!`, error `danger` `✕`. The message is `ink`.
- One sentence, no full stop, names the record (`Moved ROW-9 to Done`). An error adds the hint from its `RowblyError`.
