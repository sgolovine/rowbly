# WP05 — Stories

**Depends on:** WP04 · **Phase:** 2 · **Critical path**

## Owns

- Service: `src/services/stories.ts`.
- Commands: `src/commands/stories.ts`.
- TUI: `src/tui/screens/stories/**`, which includes the story detail screen, the story form and the story list.
- README section `stories`.
- Tests for all of the above.

## Behaviour

- **Create**:
  - The key is `prefix-(maxNumber+1)` (ADR-0003). If writing the file finds that it already exists, re-scan and retry once.
  - The stage defaults to the first effective stage. The story is ranked at the bottom of its stage.
  - `createdBy` is set to Me when Me is in the roster.
  - `nextTaskNumber` starts at 1; `tasks` and `comments` start empty.
- **Referential validation** follows contracts §2. Check assignees against the roster and epics through the **epics repository**. Do not use the epics service, which WP07 owns. Validate custom field values with WP04's `_customFieldValues.ts`.
- **Update** applies the patch semantics from the CLI flags: replace or add/remove for assignees and labels, `--no-*` clears, `--unset-field` removes a value. It also refreshes `updatedAt`.
- **Move** places the story at the bottom of the target stage, or at the top with `--top`. **Rank** works within the story's current stage. Both write only that story's file.
- **List**:
  - scope is the board, or `--all-boards` for the whole workspace;
  - supports every filter in contracts §5;
  - sorts by stage order then rank by default;
  - the human table columns are Key, Name, Stage (badge), Priority, Assignees, Labels and Due;
  - `--json` outputs an array of Story objects.
- **Show** (human mode) prints the metadata, custom fields, description, a task summary (`2/5 done`) and the number of comments.
- **`labelsInUse(ref)`** returns the distinct labels used on the board, for TUI suggestions.
- **TUI**:
  - a story list screen with filters (stage, assignee, `me`, label, priority, epic, search);
  - a create/edit form covering every field: name, multiline description through `$EDITOR`, stage, assignees as a multi-select from the roster, epic, priority, labels as free text with suggestions, due date, and custom fields rendered by type;
  - a story detail screen with tabs **Details | Tasks | Comments**, where the Tasks and Comments tabs render `StoryTasksTab` and `CommentsPanel` (placeholders until WP06 replaces them);
  - actions on the detail screen: `e` edit, `m` move stage, `d` delete.

## Acceptance criteria

- [ ] On a board with stories `WEB-1` to `WEB-3`, `create` makes `WEB-4`. After deleting `WEB-4`, the next `create` makes `WEB-4` again (key reuse is documented behaviour).
- [ ] `stories create --name X --assignee nobody` exits 2 and lists the valid handles in `details`.
- [ ] `stories create --field estimate=abc` exits 2 when `estimate` is a number field. Leaving out a required field exits 2.
- [ ] `stories rank WEB-3 --before WEB-1`, followed by `stories list`, shows WEB-3 first within the stage. A git diff shows only `WEB-3.json` changed.
- [ ] `stories move web-2 done` accepts a lower-case key.
- [ ] `stories list --open --assignee me` works when Me is set and exits 2 when it isn't.
- [ ] `stories show WEB-1 --json` round-trips through the Story schema.
- [ ] TUI tests cover creating a story through the form (including a select custom field) and moving a story from the detail screen.
