# ConfirmDialog

A ConfirmDialog is a small Modal. It asks a question before an Operation that the user cannot undo.

- It shows one question that names the record. Then it shows, in `ink-faint`, the items that go with the record.
- The key that confirms the Operation is in `danger` for a delete, and in `ink` for all other Operations. Its description is the verb (`delete`), and never "yes".
