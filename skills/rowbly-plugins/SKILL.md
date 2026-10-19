---
name: rowbly-plugins
description: "Use when turning Rowbly Plugins on or off for a Data Root, editing
  Plugin settings, or using the Built-in Plugins' commands: Epics (rowbly epics,
  --epic), Specs (rowbly specs, --spec, Story and Board Specs) and Comments
  (rowbly comments). Also when a rowbly command is unknown because its Plugin is
  off, or a Plugin failed to load. Not for writing a new Plugin."
metadata:
  purpose: >-
    Explain how an agent turns Rowbly's Built-in Plugins on and off, handles
    Plugin settings and load failures, and uses the Epics, Specs and Comments
    commands and Story options.
  type: sub-skill
  library: rowbly
  library_version: 0.1.0
requires:
  - rowbly-cli
sources:
  - README.md
  - docs/plugins/README.md
  - docs/plugins/built-in.md
  - src/commands/plugins.ts
  - src/plugins/epics/commands.ts
  - src/plugins/specs/commands.ts
  - src/plugins/comments/commands.ts
---

# Use Rowbly Plugins

Read `rowbly-cli` first. Every command below takes `--json --no-prompt`.

Plugins add optional features. Rowbly ships three Built-in Plugins: **Epics**, **Specs** and
**Comments**. Each is off until the Data Root turns it on. Turning a Plugin on applies to
everyone who uses that Data Root, because the setting is in the committed `rowbly.config.json`.

## 1. See and change which Plugins are on

```sh
rowbly plugins list --json --no-prompt           # [{id, name, enabled, loaded, known, …}]
rowbly plugins enable epics --json --no-prompt    # {"id": "epics", "enabled": true}
rowbly plugins disable epics --json --no-prompt   # keeps its settings and data
rowbly plugins show epics --json --no-prompt
```

Every Plugin command also takes `--json`, and prints the changed record.

- `rowbly epics …` exiting 2 with `unknown command 'epics'` and the hint `Plugin "epics" is off` means
  the Plugin is off. Turning it on is a change to shared configuration. Do it when the user's request
  needs the feature, and say that you did.
- A Plugin that is on adds a command (`rowbly <id>`), options on core commands (`stories create --epic`),
  rows to `stories show`, and checks to `doctor`. Its data is stored on records as
  `"plugins": { "<id>": { … } }` and in `plugins/<id>/` folders. Rowbly keeps that data unchanged while
  the Plugin is off.
- An entry with `enabled: true` and `loaded: false` failed to load. `plugins list` shows the reason,
  and `rowbly doctor` reports `PLUGIN_FAILED`. Its data is kept.

### Settings

A Plugin's settings sit beside `enabled` in its entry in `rowbly.config.json`. A Board can override them
under `"plugins": { "<id>": { … } }` in its `board.config.json`. Rowbly has no settings command: edit the
JSON by hand. This is the only hand edit the agent rules allow.

- Keep the `enabled` key as it is. Only `plugins enable` / `plugins disable` should change it.
- If a Plugin needs a setting, `plugins enable` exits 2 with the hint
  ``fix "plugins.<id>" in rowbly.config.json``. Add the setting, then enable it again.
- Epics, Specs and Comments have no settings today.

## 2. Epics: group Stories from any Boards

An Epic is identified by a slug and spans any Boards. A Story belongs to at most one Epic.

```sh
rowbly epics create auth --name "Authentication" --description "Sign-in and sessions" --json --no-prompt
rowbly stories create --board web --name "Login page" --epic auth --json --no-prompt
rowbly stories edit API-3 --epic auth --json --no-prompt        # or --no-epic to unlink
rowbly stories list --board web --epic auth --json --no-prompt  # or --no-epic
rowbly epics show auth --json --no-prompt                       # its Stories by Board, and Epic Progress
rowbly epics list --json --no-prompt                            # open Epics; --closed or --all
rowbly epics close auth --no-prompt                             # reopen with: epics reopen auth
rowbly epics delete auth --no-prompt                            # unlinks its Stories, with a warning
```

- Epic Progress is the share of the Epic's Stories in a `done`-category Stage. It is calculated each
  time and never stored. To finish an Epic, move its Stories to a done Stage, then `epics close` it.
- `epics edit <id>` needs `--name` or a description flag, or it exits 2.
- An Epic file is `.rowbly/plugins/epics/<id>.json`; a Story's link is `plugins.epics.epic`.

## 3. Specs: markdown documents for Stories and Boards

A **Story Spec** belongs to one Story (at most one per Story). A **Board Spec** belongs to a Board, has a
slug, and Stories on that Board link to it. A Spec's title is its first `# ` heading.

```sh
# The Story Spec of WEB-42 (always name it with --story, never as a slug)
printf '%s\n' "## Scope" "" "Email and password only." \
  | rowbly specs create --story WEB-42 --title "Login page" --file - --json --no-prompt
rowbly specs show --story WEB-42 --json --no-prompt             # {title, text}

# A Board Spec, and links from Stories
rowbly specs create auth-flow --board web --title "Auth flow" --text "Tokens expire after 1 h." --json --no-prompt
rowbly stories edit WEB-42 --add-spec auth-flow --json --no-prompt   # --spec replaces, --remove-spec unlinks
rowbly stories list --board web --spec auth-flow --json --no-prompt
rowbly specs list --board web --json --no-prompt
rowbly specs edit auth-flow --board web --file ./auth-flow.md --json --no-prompt
rowbly specs delete auth-flow --board web --yes --json --no-prompt   # unlinks it from every Story
```

- Text comes from `--text`, `--file <path>` or `--file -` (stdin). Do not use `--edit`.
- A Story can link only to Board Specs of its own Board.
- A Board that has Board Specs cannot be deleted without `--force`, even when it has no Stories.
- If changing links exits 6 because the Story's stored links are invalid, `--reset-specs` (alone or with
  `--spec`) replaces them.

## 4. Comments: notes on Stories and Tasks

```sh
rowbly comments add WEB-42 --body "Blocked on the API token endpoint." --json --no-prompt
rowbly comments add WEB-42.1 --body-file ./notes.md --json --no-prompt   # on a Task
rowbly comments list WEB-42 --json --no-prompt                           # oldest first
rowbly comments edit WEB-42 lcMT5Ekv --body "Unblocked." --json --no-prompt
rowbly comments delete WEB-42 lcMT5Ekv --yes --json --no-prompt
```

- The target is a Story Key or a Task id. A Story's Comments do not include its Tasks' Comments.
- The author is Me when Me is in the roster, otherwise `null`. Comment ids are 8 random characters; get
  them from `list` or `add`.
- The body comes from exactly one of `--body`, `--body-file <path|->` or `--edit`. An empty body exits 2.
- Use Comments to record progress, blockers and decisions on the Story you are working on.

## Common mistakes

- **HIGH: naming a Story Spec by slug.** `specs show web-42` looks for a Board Spec with that slug,
  because Story Keys are case-insensitive and `web-42` is also a valid slug. Use `--story WEB-42`.
- **HIGH: `--spec` on `stories edit` to add one link.** It replaces all links. Use `--add-spec`.
- **MEDIUM: turning a Plugin off to silence an error.** Its commands disappear, but its data and the
  underlying problem stay. Read `plugins list` and `rowbly doctor` instead.
- **MEDIUM: a Plugin error with exit 1.** A Plugin that fails unexpectedly during a change saves nothing;
  the JSON error has `details.plugin` and `details.stage`. Report it to the user; do not retry in a loop.
  `ROWBLY_DEBUG=trace` prints each Plugin step to stderr.

## Completion

`rowbly plugins list --json --no-prompt` shows the Plugins you need with `enabled: true` and `loaded: true`.
Each Plugin command exited 0, and `stories show <KEY> --json --no-prompt` shows the expected
`plugins.<id>` data.
