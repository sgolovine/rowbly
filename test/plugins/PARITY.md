# Built-in Plugin mutations on both surfaces

Every change a Built-in Plugin makes to Rowbly data, with the test that drives it from the command line
and the test that drives it from the TUI. Both surfaces call the same service operation, so these tests
check that each surface reaches the operation with the same input. They don't repeat the operation's own
rules, which the service suites (`tasks.test.ts`, `epics.test.ts`, `specs.test.ts`, `comments.test.ts`) cover.

When you add a mutation or a surface, add a row. A blank cell needs a reason under **Exceptions** or an
owner under **Open**. Read-only differences, for example how the CLI and the TUI format a Spec or a
list, are not parity failures.

Abbreviations: `CLI` means a test in `test/plugins/<plugin>Cli.test.ts`, and `TUI` means a test in
`test/plugins/<plugin>Tui.test.tsx`, unless the cell names another file.

## Epics

| Mutation | CLI | TUI |
| --- | --- | --- |
| Create an Epic | `epics create` · CLI "creates, lists, edits, closes, reopens, shows and deletes Epics" | list `n` · TUI "creates and edits Epics, closes/reopens them, …" |
| Edit an Epic | `epics edit` · same CLI test | detail `e` · same TUI test |
| Close and reopen an Epic | `epics close` / `epics reopen` · same CLI test | detail `c` · same TUI test, and "shows open, closed and all Epics in the list" |
| Delete an Epic, which unlinks its Stories (cancel keeps everything) | `epics delete` · same CLI test | detail `d`, then `n` or `y` · same TUI test |
| Link a Story to an Epic or unlink it | `stories create/edit --epic`, `--no-epic` · CLI "supports Story options, rows and filters and doctor --fix" | Story form Epic field · TUI "Story form selects and clears an Epic, …" |

## Specs

| Mutation | CLI | TUI |
| --- | --- | --- |
| Create, edit and delete a Board Spec (cancel keeps it) | `specs create/edit/delete` · CLI "lists, creates, shows, edits and deletes Board Specs with confirmation" | Specs screens · TUI "the Specs screens create, edit and delete Board Specs …" |
| Create, edit and delete a Story Spec (cancel keeps it) | `specs … --story` · CLI "the --story forms use case-insensitive Story Keys …" | Story Spec tab · TUI "the Story Spec tab shows own text then linked Board Specs …" and "long Story Specs scroll …" |
| Link and unlink Board Specs on a Story | `--spec` (replace), `--add-spec`, `--remove-spec` · CLI "Story flags set/add/remove/filter links; …" | Story form Specs field, which replaces the selection · TUI "the Story form multi-choice links and unlinks Board Specs" |
| Delete a Board Spec that Stories link to (unlinks them) | `specs delete` · CLI "Story flags set/add/remove/filter links; deletion warns and unlinks" | Specs screens `d` · TUI "the Specs screens create, edit and delete Board Specs …" (no linked Story; see Exceptions) |
| Delete a Board whose only content is Specs | `boards delete` exits 4, `--force` deletes · CLI "guard rejects deletion of an empty Board with Specs …"; `specsBoardDeletion.test.tsx` "the CLI exits 4 without --force …" | Boards `d`, then the force confirmation the guard's `canForce` offers · TUI `specsBoardDeletion.test.tsx` "an empty Board with a Spec offers force …" |

## Tasks

| Mutation | CLI | TUI |
| --- | --- | --- |
| Create a Task and delete it (its number is never reused) | `tasks create/delete` · CLI "creates WEB-1.4 after deleting WEB-1.3" | Story Tasks tab `n`, `d` · TUI "adds a Task, moves its Stage and deletes it" |
| Edit a Task | `tasks edit` · CLI "lists, shows with inherited Assignees, and edits" | Tasks tab or Task screen `e` · TUI "edits a Task and opens its detail with inherited Assignees" |
| Move a Task to a Stage | `tasks move` · CLI "exits 2 when moving to an unknown Stage" | Tasks tab or Task screen `m` · TUI "edits, moves and deletes the Task with e, m and d, like the Tasks tab" |
| Remove a Stage that Tasks use | `stages remove` exits 4, `--move-to` moves them · CLI "refuses to remove a Stage that Tasks use, and moves them with --move-to" | Stages `d`, then the move-to picker that `needsMoveTo` offers · Open: no TUI test yet |

## Comments

| Mutation | CLI | TUI |
| --- | --- | --- |
| Add, edit and delete a Comment on a Story | `comments add/edit/delete` · CLI "lists oldest first, edits, …" and "requires --yes to delete when not interactive" | Story Comments tab · TUI "adds, edits and deletes a Comment on the Story screen tab" |
| The same Comment text from both surfaces | — | Open: UI-02 |

## Plugins and doctor

| Mutation | CLI | TUI |
| --- | --- | --- |
| Turn a Plugin on and off (its data is kept) | `plugins enable/disable` · `cli.test.ts` "list, show, enable and disable; disable deletes no data" | settings Plugins section · `tui.test.tsx` "the settings have a Plugins section, which turns Plugins on and off, …" |
| Doctor fixes of a Built-in Plugin | `doctor --fix` · CLI "supports Story options, rows and filters and doctor --fix" (Epics) and "doctor CLI reports SPECS_MISSING_SPEC …" (Specs) | Doctor screen `f` · `test/tui/doctor.test.tsx` "lists findings and fixes them with f" (see Exceptions) |

## Exceptions

- **Deleting a linked Board Spec from the TUI.** The TUI deletion calls the same Specs operation that
  unlinks Stories. The unlinking itself is covered in `specs.test.ts` and in the CLI test.
- **Doctor fixes in the TUI.** The Doctor screen runs the same `doctor.fix` service operation as
  `doctor --fix`. The screen is tested with core findings. The Plugin findings and fixes are covered in
  `epicsDoctor.test.ts`, `specs.test.ts` and the CLI tests.
- **Actions.** Actions are TUI-only (ADR-0017). No Built-in Plugin declares an Action. The fixture
  Notes Action is covered in `tui.test.tsx`.
- **Keeping other Plugin Data.** Unknown and disabled Plugin bags must survive every edit. This is
  covered for core operations in `bags.test.ts`. For TUI forms, WP05A covers it in
  `invalidBagPreservation.test.tsx`.

## Open

| Finding | Gap | Owner |
| --- | --- | --- |
| UI-02 | The TUI Comment form trims the body and the CLI keeps it as written. | WP08C adds the CLI and TUI whitespace parity tests. |
