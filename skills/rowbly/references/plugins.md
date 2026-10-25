# Plugins

Every command below takes `--json --no-prompt`.

Plugins add optional features. Rowbly ships seven Built-in Plugins, each with its own reference:

| Plugin | Adds | Reference |
| --- | --- | --- |
| `assignees` | A roster of Assignees; `--assignee` on Stories | [Assignees](plugin-assignees.md) |
| `tasks` | Tasks inside a Story (`WEB-42.1`) | [Tasks](plugin-tasks.md) |
| `epics` | Epics that group Stories from any Boards; `--epic` | [Epics](plugin-epics.md) |
| `specs` | Story Specs and Board Specs (Markdown); `--spec` | [Specs](plugin-specs.md) |
| `comments` | Comments on a Story | [Comments](plugin-comments.md) |
| `story-linking` | Blocking relationships between Stories on the same Board | [Story Linking](plugin-story-linking.md) |
| `git` | Automatic Commits of Rowbly changes | [Git](plugin-git.md) |

Each is off until the Data Root turns it on. Turning a Plugin on applies to everyone who uses that Data
Root, because the setting is in the committed `rowbly.config.json`.

## 1. See and change which Plugins are on

```sh
rowbly plugins list --json --no-prompt           # [{id, name, enabled, loaded, known, …}]
rowbly plugins show epics --json --no-prompt     # a Plugin and its stored settings
rowbly plugins enable epics --json --no-prompt   # {"id": "epics", "enabled": true}
rowbly plugins disable epics --json --no-prompt  # keeps its settings and data
```

- `rowbly epics …` exiting 2 with `unknown command 'epics'` and the hint `Plugin "epics" is off` means
  the Plugin is off. Turning it on is a change to shared configuration. Do it when the user's request
  needs the feature, and say that you did. Ask first for Assignees (it changes how Stories are
  assigned) and Git (future Rowbly writes create commits).
- A Plugin that is on adds a command (`rowbly <id>`), options on core commands (`stories create --epic`,
  listed in their `--help`), rows to `stories show`, and checks to `doctor`. Its data is stored on
  records as `"plugins": { "<id>": { … } }` and in `plugins/<id>/` folders. Rowbly keeps that data
  unchanged while the Plugin is off, and `--json` prints records with it.
- Command mode reads the configuration on every run, so a Plugin turned on is usable by the next
  command.

## 2. A Plugin that failed

- An entry with `enabled: true` and `loaded: false` failed to load: its settings are invalid, it threw
  while it started, it clashed with a name in use, or this version of Rowbly does not have it.
  `plugins list` shows the reason, and `rowbly doctor` reports `PLUGIN_FAILED`. It is skipped with a
  warning and its data is kept.
- A Plugin can refuse a change: exit 4 (`CONFLICT`). An expected error from a Plugin keeps its own code,
  such as `VALIDATION` (exit 2) for bad input.
- A Plugin that fails unexpectedly during a change saves nothing, and the command exits 1. The JSON
  error has `details.plugin` and `details.stage`. Report it to the user; do not retry in a loop.
  `ROWBLY_DEBUG=trace` prints each operation and Plugin step, with its time and outcome, to stderr.

## 3. Settings

A Plugin's shared settings sit beside `enabled` in its entry in `rowbly.config.json`
(`"plugins": { "<id>": { "enabled": true, … } }`). A Board can override them under
`"plugins": { "<id>": { … } }` in its `board.config.json`. For these shared settings, edit the JSON by
hand: this is the only hand edit allowed under `.rowbly/`.

- Keep the `enabled` key as it is. Only `plugins enable` / `plugins disable` should change it.
- If a Plugin needs a setting, `plugins enable` exits 2 with the hint
  ``fix "plugins.<id>" in rowbly.config.json``. Add the setting, then enable it again.
- Assignees, Tasks, Epics, Specs, Comments and Story Linking have no settings today. Git has personal preferences in
  Local State instead; change them with `rowbly git configure` ([Git](plugin-git.md)).
- Run `rowbly doctor --json --no-prompt` after a hand edit.

## 4. Data from a Rowbly before Plugins

Earlier Rowbly versions kept Epics, Comments, Tasks and Assignees in core. Rowbly has no importer for
that data. Doctor reports top-level `comments` on Stories, a Story's `epicId` or `assignees`, an
`assignees` roster in `rowbly.config.json` and Epic files in `epics/*.json` as `LEGACY_DATA`; the next
save of that Story or of `rowbly.config.json` drops them. Old top-level `tasks` are dropped without a
finding. Commit or back up `.rowbly/` before you change those Stories, tell the user, and recreate what
they need with the Plugins.

## Common mistakes

- **MEDIUM: turning a Plugin off to silence an error.** Its commands disappear, but its data and the
  underlying problem stay. Read `plugins list` and `rowbly doctor` instead.
- **MEDIUM: editing `enabled` by hand.** It skips the checks `plugins enable` runs. Use the commands.
- **MEDIUM: a Plugin error with exit 1.** Nothing was saved. Report it with `details.plugin`; do not
  retry in a loop.

## Completion

`rowbly plugins list --json --no-prompt` shows the Plugins you need with `enabled: true` and
`loaded: true`. Each Plugin command exited 0, and `stories show <KEY> --json --no-prompt` shows the
expected `plugins.<id>` data.
