# WP06 — Tasks & Comments

**Depends on:** WP05 · **Phase:** 2

## Owns

- Services: `src/services/tasks.ts` and `src/services/comments.ts`.
- Commands: `src/commands/tasks.ts` and `src/commands/comments.ts`.
- TUI: `src/tui/screens/tasks/**` and `src/tui/screens/comments/**`. This replaces the `StoryTasksTab` and `CommentsPanel` placeholders that WP05 renders.
- README sections `tasks` and `comments`.
- Tests for all of the above.

## Behaviour

- **Tasks** are embedded in the Story file:
  - `create` assigns `<KEY>.<nextTaskNumber>`, increments the counter (ids are never reused), and defaults the stage to the first effective stage;
  - every mutation updates both the task's and the story's `updatedAt`;
  - tasks have no assignees: they belong to the story's assignees, and `tasks show` displays the story's assignees as inherited.
- **Task ordering** is creation order. Tasks have no rank.
- **Task stage** is validated against the parent board's effective stages.
- **Comments**:
  - a comment target is a Story Key or a Task id (parsed with `parseTaskId`);
  - ids come from `ctx.newId()` (nanoid 8);
  - the author is Me if Me is in the roster, otherwise `null`;
  - the body comes from `--body`, `--body-file` or `--edit`, and an empty body is a `ValidationError`;
  - comments are listed oldest first;
  - `edit` updates the comment's `updatedAt`.
- **TUI**:
  - the Tasks tab lists tasks with stage badges, and supports `n` new, `enter` detail, `m` move stage, `e` edit and `d` delete;
  - the task detail view embeds a `CommentsPanel` for that task;
  - `CommentsPanel` shows author, relative time and body, and supports `c` add (through `$EDITOR`), `e` edit and `d` delete.

## Acceptance criteria

- [ ] Creating 3 tasks, deleting `WEB-1.3`, then creating another gives `WEB-1.4`.
- [ ] `tasks move WEB-1.1 unknown-stage` exits 2.
- [ ] `comments add WEB-1.2 --body "hi"` stores the comment on the task, not on the story.
- [ ] `comments add WEB-1 --edit` with `EDITOR` set to a script stores the script's output.
- [ ] `comments delete WEB-1 <id>` without `--yes` in a non-interactive run exits 2.
- [ ] TUI tests cover adding a task, moving its stage, and adding a comment from the story detail tabs.
