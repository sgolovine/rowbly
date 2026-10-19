---
name: rowbly-setup
description: "Use when setting up or configuring Rowbly in a repository:
  creating the .rowbly/ Data Root with rowbly init, adding Boards and key
  prefixes, the Assignee roster and Me (whoami), the current Board (use), and
  changing Stages or Custom Fields at Board or global level through the
  Configuration Cascade. Not for day-to-day Story work (rowbly-stories)."
metadata:
  purpose: >-
    Guide an agent through creating and configuring a Rowbly Data Root:
    init, Boards, the Assignee roster and Me, and Stages and Custom Fields
    edited at the correct Configuration Cascade level.
  type: lifecycle
  library: rowbly
  library_version: 0.1.0
requires:
  - rowbly-cli
sources:
  - README.md
  - docs/architecture/data-model.md
  - src/commands/setup.ts
  - src/commands/boards.ts
  - src/commands/assignees.ts
  - src/commands/stages.ts
  - src/commands/fields.ts
---

# Set up and configure Rowbly

Read `rowbly-cli` first. Every command below also takes `--json --no-prompt`. They are left out here
to keep the examples short.

## 1. Create the Data Root and the first Board

First check that there is no Data Root already: `rowbly use --json --no-prompt` exits 5 when there is
none. Run `init` from the repository root, so that `.rowbly/` sits beside `.git`. A Data Root found
in a parent directory or in `~/.rowbly` would otherwise catch the commands.

```sh
rowbly init --board web --board-name Website --prefix WEB --json --no-prompt
```

- This creates `.rowbly/` with `rowbly.config.json` (the default Stages), a `.gitignore`, and the Board
  `web`. It also makes `web` the current Board. Its Stories are keyed `WEB-1`, `WEB-2`, ….
- `--global` creates `~/.rowbly` instead. Use it only when the user asks for one tracker for all
  their projects.
- An existing Data Root exits 4. Do not delete it to start again.
- `init` turns on no Plugins; see `rowbly-plugins`.

Check: `ls .rowbly` shows `rowbly.config.json`, `.gitignore` and `boards/web/board.config.json`. Commit
`.rowbly/`; `local.json` stays out because of the `.gitignore`.

## 2. Add more Boards

```sh
rowbly boards create api --name "API" --prefix API --description "Backend service"
rowbly boards list --json --no-prompt
```

- The Board id is a slug. The key prefix must be unique in the Data Root (a clash exits 4). Lower case
  is upper-cased. **The prefix cannot be changed later**: `boards edit` takes only `--name` and
  `--description`. Choose it with the user.
- `boards delete <id>` needs `--yes` and refuses a Board that still has Stories (exit 4) unless
  `--force`. With the Specs Plugin on, Board Specs also block it. Never pass `--force` without the
  user's explicit approval: it deletes every Story on the Board.

## 3. Set up Assignees and Me

```sh
rowbly assignees add sam --name "Sam Lee" --email sam@example.com
rowbly whoami sam
```

- A handle is a slug, unique in the Data Root. An email is optional. When an Assignee's email matches
  `git config user.email`, Rowbly recognises that person as Me without `whoami`.
- Me is the creator of new Stories (and the author of Comments). It is Local State in `local.json`,
  so it is per developer and is never committed. Only set Me to the person you work for; do not
  invent an Assignee for yourself unless the user asks.
- `assignees remove <handle>` also takes the handle off every Story, and warns with the count.
- `assignees edit <handle> --email ""` removes an email.

## 4. Change Stages and Custom Fields

Stages and Custom Fields are configuration, defined at one of two levels:

1. `global`: `rowbly.config.json`, for every Board that has no list of its own;
2. `board`: the Board's `board.config.json`.

A Board uses the most specific level that has a list. The lists are **not merged**. With no list
anywhere, a Board has the built-in Stages `backlog`, `todo`, `in-progress` and `done`, and no Custom
Fields. See where each list comes from before you change it:

```sh
rowbly config show --board web --json --no-prompt   # effective Stages and Custom Fields, and their level
```

`stages` and `fields` commands take `--level board|global` and `--board <id>`. The default level is
`board` when a Board resolves, otherwise `global`. Editing a level that has no list first copies the
inherited list to it, then applies the change. So the first `--level board` edit gives that Board its
own full copy, and from then on later global changes no longer reach that Board.

```sh
# Only on Board web: add a review Stage after in-progress
rowbly stages add review --name "Review" --category in_progress --after in-progress --board web --level board
# For every Board that inherits the global list
rowbly stages add blocked --name "Blocked" --category in_progress --level global
rowbly stages move review --before done --board web
rowbly stages edit review --name "Code review" --board web
rowbly stages remove review --move-to in-progress --board web
```

- Every Stage has a Stage Category: `todo`, `in_progress` or `done`. Reports and `stories list --open`
  use the category, not the Stage key.
- `stages remove` refuses (exit 4) while a Story, or a Task with the Tasks Plugin on, is in the Stage;
  `--move-to <key>` moves them
  first. The last Stage cannot be removed.
- With `--json`, stage commands print `{ level, items, affectedBoards }`. Check `affectedBoards` after a
  global change.

```sh
rowbly fields add estimate --name "Estimate" --type number --min 0 --max 13 --integer --board web
rowbly fields add area --name "Area" --type select --options frontend,backend,infra --required --board web
rowbly fields edit area --options frontend,backend,infra,docs --board web
rowbly fields remove estimate --board web
```

- Types: `text`, `number`, `boolean`, `date`, `url`, `select`, `multiselect`. A field's key and type
  never change; to change a type, remove the field and add it again.
- `fields remove`, or an edit such as dropping an option, **strips the values** that no longer fit from
  every Story on the affected Boards, and warns with the count. Confirm with the user before you remove
  a field or option that Stories use.
- Marking a field `--required` does not fill existing Stories; `rowbly doctor` then reports
  `MISSING_REQUIRED_FIELD` for them.

## Common mistakes

- **HIGH: editing at the wrong level.** Adding a Stage without `--board`/`--level` while a Board is in
  context edits that Board only, and freezes its copy of the list. Decide whether the user wants one
  Board or all Boards, and pass `--level` explicitly.
- **HIGH: running `init` inside an existing tree.** A parent `.rowbly/` already serves this directory; a
  new one hides it. Check with `rowbly use --json --no-prompt` first.
- **MEDIUM: editing `rowbly.config.json` or `board.config.json` by hand** for Stages, Fields or
  Assignees. That bypasses validation, and Stories can be left in Stages that no longer exist. Use the
  commands.

## Completion

`rowbly config show --board <id> --json --no-prompt` shows the Stages and Custom Fields you intended,
from the level you intended, and `rowbly doctor --json --no-prompt` exits 0. If doctor reports
findings, follow `rowbly-doctor`.
