# ConfirmDialog

A ConfirmDialog is a small Modal. It asks a question before an Operation that the user cannot undo.

- It shows one question that names the record. Then it shows, in `ink-faint`, the items that go with the record.
- The key that confirms the Operation is in `danger` for a delete, and in `ink` for all other Operations. Its description is the verb (`delete`), and never "yes".
- `ConfirmDialog` is the only confirmation popup. It draws its own generic `Modal`. Give it a `title`. Do not put it in a different `Modal`.
- The two choices are `Button`s with `y` and `n` in key caps. A click on a choice does the same operation as its key. The choice that `enter` picks has the `selection` fill.
