# ADR-0024: Every Board starts with a fixed Backlog Stage and ends with a fixed Done Stage

**Status:** Accepted. Built. Amends ADR-0005 and ADR-0016.

The Stage Categories were `todo`, `in_progress` and `done`, and every Stage in a configured list chose one. A Board could have no Stage in `done`, several Stages in `done`, or a `done` Stage in the middle, so the board view could not group Stories into "not started", "on the board" and "finished" without guessing. The board's list view needs those three groups.

**§1 The Stage Categories are `backlog`, `board` and `done`.** Each Board has exactly one Stage in `backlog` and one in `done`:

- **Backlog** (key `backlog`, name `Backlog`) is always the first Stage, and is the only Stage in `backlog`.
- **Done** (key `done`, name `Done`) is always the last Stage, and is the only Stage in `done`.
- Every other Stage sits between them and is in `board`.

**§2 Backlog and Done are not configuration.** A `stages` list in the Configuration Cascade (ADR-0005) holds only the Stages between them, as `{ key, name }` with no Stage Category; it may be empty. Rowbly adds Backlog before the list and Done after it when it resolves a Board's Stages. The keys `backlog` and `done` are reserved: a configured Stage cannot use them, and `stages.update`, `stages.move` and `stages.remove` refuse them. A position next to them is a position among the configured Stages: after Backlog is first, before Done is last; before Backlog and after Done are refused. Backlog and Done can be the target of `stages.remove --move-to`. Their names cannot change.

**§3 The built-in Stages are `todo` (Todo) and `in-progress` (In Progress)**, so a Board without a list anywhere still has Backlog, Todo, In Progress and Done, as before.

**§4 No migration.** Rowbly has not been released. A `stages` list that still names `backlog` or `done` fails validation (`SCHEMA_INVALID`), and a stored `category` is dropped the next time the list is written. A Data Root in the old shape is fixed by hand.

**§5 ADR-0016.** "Enters an `in_progress` Stage" in the Git automation design now means entering a Stage in `board`.

We rejected storing Backlog and Done in the list and refusing edits to them: every list would repeat them, and a hand edit could still drop or reorder them. We rejected letting a Board rename them: the list view, Epic Progress and Tasks rely on the fixed keys, and the names are what a person scans for.
