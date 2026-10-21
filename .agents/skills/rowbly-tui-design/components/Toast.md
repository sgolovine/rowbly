# Toast

A short message bottom-right after an Operation, that goes away on its own (info 4 s, warning 6 s, error 8 s).

- Frame and glyph in the kind's colour: info `accent` `✓`, warning `stage-board` `!`, error `danger` `✕`. The message is `ink`.
- One sentence, no full stop, names the record (`Moved ROW-9 to Done`). An error adds the hint from its `RowblyError`.
