# Set up and configure Rowbly

Every command below also takes `--json --no-prompt`. They are left out here to keep the examples short.

## 1. Create the Data Root and the first Board

First check that there is no Data Root already: `rowbly use --json --no-prompt` exits 5 when there is
none. Run `init` from the repository root, so that `.rowbly/` sits beside `.git`. A Data Root found
in a parent directory or in `~/.rowbly` would otherwise catch the commands.

```sh
rowbly init --board web --board-name Website --prefix WEB --json --no-prompt
```

- This creates `.rowbly/` with `rowbly.config.json` (the default Stages), a `.gitignore`, and the Board
  `web`. It also makes `web` the current Board. Its Stories are keyed `WEB-1`, `WEB-2`, ….
  With `--json` it prints `{ root, board, known }`, `known` being the Data Root's entry in
  `~/.rowblyrc.json`.
- `--global` creates `~/.rowbly` instead. Use it only when the user asks for one tracker for all
  their repositories. `--data-root <path>` creates the Data Root at that folder (the `.rowbly` folder
  itself); never pass both. With neither, and with `--no-prompt`, `init` creates `.rowbly/` in the
  current directory; it asks only in an interactive terminal.
- `init` records the Data Root in `~/.rowblyrc.json`. `--label <label>` names it there, and the TUI
  shows that label in its header and its Data Root switcher. `--default`
  makes it the default Data Root, which every directory then opens ahead of its own `.rowbly/`, and
  unmarks any other default. Pass `--default` only when the user asks for it. Without it, a warning
  says when another default Data Root is opened ahead of the new one; tell the user, and pass
  `--data-root <path>` to work in the new one.
- `init` checks the location, the Board and `~/.rowblyrc.json` before it writes anything, so a failed
  `init` usually leaves nothing to clean up. If the error's hint says the Data Root was created, follow
  that hint; do not delete the folder unless the user agrees.
- An existing Data Root exits 4. Do not delete it to start again.
- `init` turns on no Plugins. Turn one on with `rowbly plugins enable <id>` only when the user wants
  its feature; it changes the Data Root for everyone (see [Plugins](plugins.md)).

Check: `ls .rowbly` shows `rowbly.config.json`, `.gitignore` and `boards/web/board.config.json`. Commit
`.rowbly/`; `local.json` stays out because of the `.gitignore`.

## 2. Add and manage Boards

```sh
rowbly boards create api --name "API" --prefix API --description "Backend service"
rowbly boards list --json --no-prompt
rowbly boards show api --json --no-prompt     # effective Stages and Custom Fields, their level, Stories per Stage
rowbly boards edit api --name "Backend API"   # only --name and --description
rowbly use api                                # make it the current Board (Local State, not committed)
rowbly use --clear                            # forget the current Board
```

- The Board id is a slug. The key prefix must be unique in the Data Root (a clash exits 4). Lower case
  is upper-cased. **The prefix cannot be changed later**: `boards edit` takes only `--name` and
  `--description`. Choose it with the user.
- A new Board has no Stage or Custom Field lists of its own: it inherits them (section 4).
- `boards delete <id>` needs `--yes` and refuses a Board that still has Stories (exit 4) unless
  `--force`. With the Specs Plugin on, Board Specs also block it. Never pass `--force` without the
  user's explicit approval: it deletes every Story on the Board. Deleting the current Board clears it
  from Local State.
- `rowbly use <id>` changes the developer's own context. In a script, pass `--board` instead.

## 3. Set up Me

```sh
rowbly whoami --json --no-prompt     # {"me", "source", "global", "local"}; source is local, global or null
rowbly whoami sam                    # global Me, for every Data Root; needs no Data Root
rowbly whoami --local sam            # local Me, for this Data Root only (Local State)
rowbly whoami --clear                # clear global Me; with --local, clear the local Me
```

- Me is a handle (a lower-kebab-case slug): the creator of new Stories (`createdBy`), the author of
  Comments, and what `--assignee me` means. Global Me is in `~/.rowblyrc.json` and applies to every
  Data Root on the machine; a local Me is in `local.json`, replaces global Me in that Data Root, and is
  never committed.
- Check `whoami` first: when Me is already set, leave it. Only set Me to the person you work for; do
  not invent a handle for yourself unless the user asks, and do not change an existing global Me
  without asking, since it changes every Data Root.
- If the team assigns Stories, the roster is the Assignees Plugin
  ([Assignees Plugin](plugin-assignees.md)). Add Me's handle to it too, or doctor warns
  `ASSIGNEES_UNKNOWN_ME` for a local Me.

## 4. Change Stages and Custom Fields

Stages and Custom Fields are configuration, defined at one of two levels (the Configuration Cascade):

1. `global`: `rowbly.config.json`, for every Board that has no list of its own;
2. `board`: the Board's `board.config.json`.

A Board uses the most specific level that has a list. The lists are **not merged**. Every Board
starts with the fixed Stage `backlog` and ends with the fixed Stage `done`; a `stages` list holds only
the Stages between them. With no list anywhere, those are `todo` and `in-progress`, and there are no
Custom Fields. See where each list comes from before you change it:

```sh
rowbly config show --board web --json --no-prompt   # effective Stages and Custom Fields, and their level
rowbly stages list --board web --json --no-prompt
rowbly fields list --board web --json --no-prompt
```

`config show` reports each list's level as `board`, `global` or `default`. `stages` and `fields`
commands take `--level board|global` and `--board <id>`. The default level is `board` when a Board
resolves, otherwise `global`. Editing a level that has no list first copies the inherited list to it,
then applies the change. So the first `--level board` edit gives that Board its own full copy, and from
then on later global changes no longer reach that Board.

### Stages

```sh
# Only on Board web: add a review Stage after in-progress
rowbly stages add review --name "Review" --after in-progress --board web --level board
# For every Board that inherits the global list (added just before done)
rowbly stages add blocked --name "Blocked" --level global
rowbly stages move review --before done --board web     # or --after <key>, --first, --last
rowbly stages edit review --name "Code review" --board web
rowbly stages remove review --move-to in-progress --board web
```

- Every Stage has a Stage Category: `backlog` (only `backlog`), `board` (every configured Stage) or
  `done` (only `done`). There is no `--category` flag; reports and `stories list --open` use the category.
- `backlog` and `done` are fixed. `stages edit`, `move` and `remove` refuse them (exit 2) and `add`
  cannot reuse their keys. `add` puts a Stage just before `done` by default. Place a Stage with
  `--after backlog` or `move --first` (first), `--before done` or `move --last` (last).
- `stages remove` refuses (exit 4) while a Story, or a Task with the Tasks Plugin on, is in the Stage;
  `--move-to <key>` moves them first (to the bottom of that Stage), and `backlog` or `done` may be the
  target.
- With `--json`, stage commands print `{ level, items, affectedBoards }` (plus `storiesMoved` for
  `remove`). `items` lists every Stage of the level, `backlog` and `done` included, each with its
  `category`. Check `affectedBoards` after a global change.

### Custom Fields

```sh
rowbly fields add estimate --name "Estimate" --type number --min 0 --max 13 --integer --board web
rowbly fields add area --name "Area" --type select --options frontend,backend,infra --required --board web
rowbly fields edit area --options frontend,backend,infra,docs --board web   # also --name, --description, --required|--optional
rowbly fields remove estimate --board web
```

- Types: `text`, `number`, `boolean`, `date`, `url`, `select`, `multiselect`. `--options` applies to
  `select` and `multiselect`; `--min`, `--max` and `--integer` to `number`. A field's key and type
  never change; to change a type, remove the field and add it again.
- `fields remove`, or an edit such as dropping an option, **strips the values** that no longer fit from
  every Story on the affected Boards, and warns with the count. Confirm with the user before you remove
  a field or option that Stories use.
- Marking a field `--required` does not fill existing Stories; `rowbly doctor` then reports
  `MISSING_REQUIRED_FIELD` for them.
- Stories take values as `--field key=value` ([Stories](stories.md)).

## 5. Install or start a skill that uses Rowbly

Run these from the folder the skill is for (usually the repository root). To install an official
skill (one shipped with Rowbly: `rowbly`, or `rowbly-dev` to take a Story to a draft pull request) or
copy an existing skill folder, use `install`; for a new agent skill that works with Rowbly, use
`create`:

```sh
rowbly skills install rowbly --harness claude --json --no-prompt   # {name, description, harnesses, path, official}
rowbly skills install ../shared/release-notes --harness claude     # any folder that holds SKILL.md
rowbly skills create release-notes --harness claude --description "Write release notes from done Stories"
rowbly skills list --json --no-prompt    # {official: [{name, description, installed: [{harnesses, path}]}], custom: [...]}
```

- `install` copies the whole folder to `<folder>/<name>`, named by its `SKILL.md` frontmatter `name`.
  Pass a path or an official skill name: without one it opens a menu, so with `--no-prompt` it exits 2.
  A path without `SKILL.md` exits 2; an unknown name exits 3.

- `create` writes `<folder>/<name>/SKILL.md`, which opens with a paragraph that points at
  `references/rowbly-reference.md`, and that reference page. Then write the skill's steps in `SKILL.md`.
- `--harness` picks the folder: `generic` (the default) and `codex` `.agents/skills`, `claude`
  `.claude/skills`, `gemini` `.gemini/skills`, `pi` `.pi/skills`, `cursor` `.cursor/skills`. Ask which
  agent the user runs when they do not say.
- The name is lowercase letters, digits and single hyphens (exit 2 otherwise). A skill folder that
  already exists exits 4 and is not changed; pick another name rather than deleting it.
- `list` shows the official skills with where each is installed, and the custom skills: the other
  skills below the current folder that hold the reference.

## Common mistakes

- **HIGH: editing at the wrong level.** Adding a Stage without `--board`/`--level` while a Board is in
  context edits that Board only, and freezes its copy of the list. Decide whether the user wants one
  Board or all Boards, and pass `--level` explicitly.
- **HIGH: running `init` inside an existing tree.** A parent `.rowbly/` already serves this directory; a
  new one hides it. Check with `rowbly use --json --no-prompt` first.
- **MEDIUM: editing `rowbly.config.json` or `board.config.json` by hand** for Stages, Fields or
  Plugin entries. That bypasses validation, and Stories can be left in Stages that no longer exist.
  Use the commands.

## Completion

`rowbly config show --board <id> --json --no-prompt` shows the Stages and Custom Fields you intended,
from the level you intended, and `rowbly doctor --json --no-prompt` exits 0. If the Data Root's
`ROWBLY.md` mentions a Stage, Custom Field or Plugin you changed, tell the user and, with their
agreement, update it ([Data Root layout](data-root.md#rowblymd-how-this-data-root-is-used)). If doctor reports
findings, follow [Check and repair a Data Root](doctor.md).

## Experimental Features

`rowbly feature-flags list --json --no-prompt` lists the Experimental Features this version knows:
`[{ key, name, description, enabled }]`, with effective boolean values. An empty registry returns
`[]`. `rowbly feature-flags set <key> <true|false> --json --no-prompt` saves a boolean and returns the
changed entry. Use a key from `list`: an unknown key exits 3 (`NOT_FOUND`), an invalid boolean exits
2 (`USAGE`). No current Board is needed. Values are in the Data Root's `rowbly.config.json` under
`featureFlags`, shared by every Board and kept across restarts. An absent key uses the code default;
explicit `false` overrides an on default. Unknown saved keys are preserved but not listed. There is
no Board or Home Config level.

## TUI onboarding

Bare `rowbly` first offers global onboarding (Me and registration of existing Data Roots), then shared
Data Root onboarding (mode, Board, Plugins, AI skills and Stage Prompts). `ctrl+k` skips and saves
completion. `onboardingComplete` is optional in the Home Config and in `rowbly.config.json`; absent
means incomplete. The latter flag is committed and suppresses onboarding for everyone sharing it.
Settings › Onboarding reopens either flow without clearing completion. Registration never creates a
Data Root; setup still creates missing Data Roots. Named missing paths still fail. Plain Kanban turns
Software Factory off; Factory/Both turn it on. Skill installs choose a folder and harness and never
overwrite existing skills. Onboarding adds no Stage Prompt templates.
