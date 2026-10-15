# Built-in Plugin mutations on both surfaces

Every change a Built-in Plugin makes to Rowbly data, with the test that drives it from the command line
and the test that drives it from the TUI. Both surfaces call the same service operation, so these tests
check that each surface reaches the operation with the same input. They don't repeat the operation's own
rules, which the service suites (`epics.test.ts`, `specs.test.ts`, `comments.test.ts`) cover.

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
| Delete a Board whose only content is Specs | `boards delete` exits 4, `--force` deletes · CLI "guard rejects deletion of an empty Board with Specs …" | Open: UI-01 |

## Comments

| Mutation | CLI | TUI |
| --- | --- | --- |
| Add, edit and delete a Comment on a Story | `comments add/edit/delete` · CLI "lists oldest first, edits, …" and "requires --yes to delete when not interactive" | Story Comments tab · TUI "adds, edits and deletes a Comment on the Story screen tab" |
| Add, edit and delete a Comment on a Task | `comments add WEB-1.2` · CLI "stores a Comment on a Task, not on its Story" | Task Comments tab · TUI "keeps a Task’s Comments on a tab of the Task screen, …" |
| The same Comment text from both surfaces | — | Open: UI-02 |

## Plugins and doctor

| Mutation | CLI | TUI |
| --- | --- | --- |
| Turn a Plugin on and off (its data is kept) | `plugins enable/disable` · `cli.test.ts` "list, show, enable and disable; disable deletes no data" | settings Plugins section · `tui.test.tsx` "the settings have a Plugins section, which turns Plugins on and off, …" |
| Doctor fixes of a Built-in Plugin | `doctor --fix` · CLI "supports Story options, rows and filters and doctor --fix" (Epics) and "doctor CLI reports SPECS_MISSING_SPEC …" (Specs) | Doctor screen `f` · `test/tui/doctor.test.tsx` "lists findings and fixes them with f" (see Exceptions) |

## Exceptions

- **Task Comments from the CLI.** `comments edit` and `comments delete` take a Story Key or a Task
  ID through the same target lookup that `comments add WEB-1.2` uses, so the CLI tests edit and delete
  only on a Story.
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
| UI-01 | The TUI has no force retry for a Board that only a Plugin guard keeps (an empty Board with Specs). | WP08B adds the Board TUI and CLI force tests. |
| UI-02 | The TUI Comment form trims the body and the CLI keeps it as written. | WP08C adds the CLI and TUI whitespace parity tests. |
