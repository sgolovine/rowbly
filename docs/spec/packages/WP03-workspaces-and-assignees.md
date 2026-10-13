# WP03 — Workspaces & Assignees

**Depends on:** WP01, WP02 · **Phase:** 2

## Owns

- Services: `src/services/workspaces.ts` and `src/services/assignees.ts`.
- Commands: `src/commands/workspaces.ts` and `src/commands/assignees.ts`.
- TUI: `src/tui/screens/workspaces/**` and `src/tui/screens/assignees/**`.
- README sections `workspaces` and `assignees`.
- Tests for all of the above.

## Behaviour

- **Workspace create** writes `workspace.config.json` with `assignees: []` and no overrides. An existing id is a `ConflictError`.
- **Workspace delete** follows contracts §7:
  - a non-empty workspace (one with boards or epics) is refused unless `--force`;
  - deletion always asks for confirmation (or `--yes`);
  - if the deleted workspace is the one in `local.json`, that context is cleared.
- **`workspaces show`** prints the name, description, number of boards, number of epics, number of assignees, and which levels override stages and fields.
- **Assignees**:
  - handles are unique within a workspace;
  - an email is optional and must be valid if given;
  - `remove` strips the handle from every Story in the workspace and returns `storiesUpdated`;
  - the command warns with the count.
- **TUI**:
  - a workspace list with create, edit and delete (using `ConfirmDialog`);
  - selecting a workspace makes it the current context (through `services.context.use`);
  - an assignee list per workspace with add, edit and remove.

## Acceptance criteria

- [ ] `rowbly workspaces create acme --name "Acme"`, then `list --json`, shows it. Creating it a second time exits 4.
- [ ] `rowbly workspaces delete acme` on a workspace with a board exits 4 without `--force`. With `--force --yes`, the folder is gone.
- [ ] In a non-interactive run, `delete` without `--yes` exits 2.
- [ ] `rowbly assignees add sam --name "Sam" --workspace acme`, then assigning sam to a story fixture, then `assignees remove sam`, prints the warning "removed from 1 story". The story file no longer lists sam.
- [ ] With a TTY and no `--no-prompt`, a missing `--name` is prompted for through Clack. Without a TTY, it exits 2.
- [ ] TUI tests cover creating a workspace through the form and removing an assignee with confirmation.
