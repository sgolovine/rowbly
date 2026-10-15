# WP04 — Boards, Stages & Custom Fields

**Depends on:** WP01, WP02 · **Phase:** 2 · **Critical path**

## Owns

- Services: `src/services/boards.ts`, `src/services/stages.ts` and `src/services/fields.ts`, plus `src/services/_customFieldValues.ts`.
- Commands: `src/commands/boards.ts`, `src/commands/stages.ts` and `src/commands/fields.ts`.
- TUI: `src/tui/screens/boards/**`, `src/tui/screens/stages/**` and `src/tui/screens/fields/**`.
- README sections `boards`, `stages` and `fields`.
- Tests for all of the above.

## Behaviour

- **Board create** requires a `--prefix` that is unique across the whole Data Root (`ConflictError` otherwise). It writes `board.config.json` with no overrides and creates `stories/`.
- **Board delete** follows contracts §7. It also clears `local.json.board` if that board is the current one.
- **Stage and field CRUD**:
  - follow the level and copy-on-write rules in contracts §3;
  - the `--level` default is `board` when a board is in context, and `workspace` otherwise;
  - every mutation returns the new list and a summary of which boards were affected.
- **Stage remove** follows contracts §7:
  - it checks every affected board for stories and tasks in that stage;
  - with `--move-to`, it moves stories to the bottom of the target stage (new ranks) and moves tasks too;
  - it refuses to remove the last stage.
- **Stage move** reorders the list.
- **Stage category edit** is allowed.
- **Field remove and option edits** strip values and report counts, as in contracts §7.
- **Field value validation and coercion** live in `_customFieldValues.ts`, which exports:
  - `coerceFieldInput(def, raw: string)`, which turns CLI strings into typed values: `true`/`false`, numbers, IsoDate, URL, and comma-separated multiselect values;
  - `validateFieldValues(defs, values, { requireRequired })`.

  WP05 imports this module, so freeze its exported signatures in the PR description.
- **`boards show`** prints the effective stages and fields with their source levels, and the number of stories per stage.
- **TUI**:
  - a board list with create, edit and delete;
  - stage management showing the order, category badges, move up/down, add, edit and remove (remove offers to pick a `--move-to` target when needed);
  - field management with a type-specific form;
  - a level switcher showing which level is being edited and the inherited source.

## Acceptance criteria

- [ ] Creating two boards with the same prefix in different workspaces exits 4.
- [ ] `stages add qa --name QA --category in_progress --after in-progress` on a board that inherits global stages:
  - writes a `stages` list into `board.config.json` that contains all of the global stages plus `qa`;
  - leaves `rowbly.config.json` unchanged.
- [ ] `stages remove todo` with stories in `todo` exits 4. Running it again with `--move-to backlog` moves them all, and their ranks sort after the stories already in `backlog`.
- [ ] A workspace-level stage removal is evaluated against every inheriting board. A board with its own `stages` is not affected.
- [ ] `fields add estimate --type number --integer --min 0`, then `coerceFieldInput` on `"3.5"`, gives a `ValidationError`.
- [ ] Removing a select option strips the matching story values, and the warning reports the count.
- [ ] TUI tests cover adding a stage at a position and removing a stage that requires a move-to target.
