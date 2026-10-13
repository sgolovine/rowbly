# WP07 — Epics

**Depends on:** WP01, WP02 · **Phase:** 2

## Owns

- Service: `src/services/epics.ts`.
- Commands: `src/commands/epics.ts`.
- TUI: `src/tui/screens/epics/**`.
- README section `epics`.
- Tests for all of the above.

## Behaviour

- **Epics** are stored at `workspaces/<ws>/epics/<id>.json`, and their ids are unique within the workspace.
- **Membership** comes from scanning every story in the workspace for `epicId === id` (ADR-0004). Use the stories repository. Do not use the stories service.
- **`EpicView.progress`** is `{ done, total }`:
  - `done` counts stories whose stage falls in the `done` Stage Category, judged by each story's own board's effective stages;
  - a story whose stage is unknown counts toward `total` but not `done`.
- **`list`** shows open epics by default. `--closed` shows only closed epics and `--all` shows both. Human columns are Id, Name, Progress (`3/8` plus a bar), Boards spanned, and Closed.
- **`show`** prints the epic's details and its stories grouped by board, with stage badges.
- **`close` and `reopen`** toggle `closed`. Closing an epic with open stories is allowed.
- **`delete`** follows contracts §7: it unlinks the epic's stories and warns with the count.
- **TUI**:
  - an epic list with progress bars;
  - an epic detail screen whose stories open the story detail screen (pushed through the router registry);
  - create, edit, close/reopen and delete.

## Acceptance criteria

- [ ] An epic linked to 3 stories across 2 boards with different stage names, where one story is in each board's `done`-category stage, reports `2/3`.
- [ ] Deleting an epic sets `epicId: null` on its 3 stories, and the warning reports 3.
- [ ] `epics list` hides closed epics. `--all` shows them.
- [ ] TUI tests cover the progress rendering and opening a story from the epic detail screen.
