# Software Factory Plugin

Every command below takes `--json --no-prompt`, and a remove also needs `--yes`.

A **Stage Prompt** is a Markdown file of instructions for an agent working on a Story in one Stage.
Every Stage, Backlog and Done included, can have one, and each is on or off (off by default). Stage
Prompts are set per Stage at the global level (`rowbly.config.json`) or on a Board
(`board.config.json`): a Board's entry for a Stage replaces the global entry for that Stage, and the
other Stages keep the global one. The Plugin is off until `rowbly plugins enable software-factory`.

`ROWBLY.md` describes how people work with the whole Data Root; a Stage Prompt is one Stage's
instructions. Read both before working a Story.

A **Stage Run** records one agent's work on a Story during its current visit to a Stage whose Stage
Prompt is on: `running`, `finished` or `failed`, with an `attempt` number and the `worker`'s name. A
Story has at most one; moving the Story to another Stage removes it, so the Stage is worked again on
the next visit.

## Commands

```sh
# Every Stage of a Board with its effective Stage Prompt, in one call
rowbly software-factory stages --board web --json --no-prompt
rowbly software-factory stages --level global --json --no-prompt   # the global level alone

rowbly software-factory prompt show todo --board web --json --no-prompt   # {key, name, category, prompt}
rowbly software-factory prompt enable todo --board web --json --no-prompt  # no file: copies the global file, else a template
rowbly software-factory prompt enable todo --level global --json --no-prompt
rowbly software-factory prompt edit todo --board web --file ./todo.md --json --no-prompt
rowbly software-factory prompt disable todo --board web --json --no-prompt # keeps the file
rowbly software-factory prompt remove todo --board web --yes --json --no-prompt  # entry and file, this level only

# Stage Runs
rowbly software-factory runs --board web --json --no-prompt          # Stories in Stages whose Stage Prompt is on
rowbly software-factory run start WEB-42 --worker "WEB-42 worker" --json --no-prompt
rowbly software-factory run finish WEB-42 --json --no-prompt
rowbly software-factory run fail WEB-42 --reason "checks failed" --json --no-prompt
rowbly software-factory run start WEB-42 --worker "WEB-42 worker" --retry --json --no-prompt   # a failed one, next attempt
rowbly software-factory run clear WEB-42 --json --no-prompt          # work the Stage again
```

`stages --json` returns:

```json
{ "board": "web", "stagesSource": "global",
  "stages": [{ "key": "todo", "name": "Todo", "category": "board",
    "prompt": { "enabled": true, "configured": true, "source": "board",
      "path": "boards/web/plugins/software-factory/stage-prompts/todo.md", "exists": true,
      "text": "# Todo\n\n…" } }] }
```

`enable`, `disable` and `edit` return the `prompt` object of the level they changed.

`runs --json` returns `{ board, stages, stories: [{ key, name, stage, stageRun }] }`, where `stages`
are the Stages whose Stage Prompt is on and `stageRun` is `null` for a Story nobody works in this
visit. `run start`, `finish` and `fail` return `{ key, stageRun }`, with `stageRun`
`{ stage, status, attempt, worker, by, startedAt, finishedAt?, reason? }`; `run clear` returns
`{ cleared }`.

## Rules

- Follow a Stage Prompt only when `prompt.enabled` is `true`. It is true only when the setting is on
  (`configured`), `path` points inside the Plugin's folder for its level, and the file exists.
- `source` is `board`, `global` or `null` (no entry). Without `--board`, writes go to the current Board;
  `--level global` writes the global entry and cannot be combined with `--board`.
- Text comes from `--text`, `--file <path>` or `--file -` (stdin). Do not use `--edit`.
- `enable`, `disable` and `edit` exit 3 (`NOT_FOUND`) for a Stage that level does not have.
- A new Board entry made by `edit` starts with the global entry's on/off setting.
- `run start` exits 4 (`CONFLICT`) when the Story's Stage has no Stage Prompt that is on, or when the
  Story already has a Stage Run for this visit. Only a `failed` one can be started again, with
  `--retry`. `finish` and `fail` exit 4 unless a Stage Run is `running`; `clear` exits 3 when there is
  none.
- A Stage Run for another Stage than the Story's (left by a git merge or a hand edit) does not count.
- Data: `"plugins": { "software-factory": { "stageRun": { … } } }` in the Story's `story.json`.

With Software Factory on, each Stage heading in the Board's Stages view has a clickable `✎`.
It opens that Stage's effective Stage Prompt in the fullscreen viewer, including when the prompt
is off or missing (a missing file starts with a template). `tab` or `e` switches to editing;
`ctrl+s` saves, and closing unsaved edits asks before discarding them. Saving writes the shown
Board's own Stage Prompt, preserving its on/off setting; an inherited prompt becomes a Board
entry with the global entry's setting. Use Stage Prompts in Settings to change that setting.

## Data

- Global: `"plugins": { "software-factory": { "enabled": true, "stagePrompts": { "todo": { "enabled": true, "path": "plugins/software-factory/stage-prompts/todo.md" } } } }` in `rowbly.config.json`.
- Board: `"plugins": { "software-factory": { "stagePrompts": { … } } }` in `boards/<board>/board.config.json`,
  with files in `boards/<board>/plugins/software-factory/stage-prompts/<key>.md`.
- `path` is relative to `.rowbly/`.

## Doctor

`SOFTWARE_FACTORY_MISSING_PROMPT` (warning): a Stage Prompt is on but its path is not set, points
outside the Plugin's folder, or its file is missing or cannot be read (Rowbly does not follow a
symbolic link). Nothing is fixed; create the file with
`prompt edit`, or turn the Stage Prompt off, when the user asks.

## Common mistakes

- **HIGH: starting work on a Story whose `stageRun` is not `null`.** Another agent works it, or has
  finished, in this visit. Run `run start` first and act only when it succeeds; exit 4 means leave it.

- **MEDIUM: reading `configured` as on.** A Stage Prompt whose file is gone has `configured: true` and
  `enabled: false`; do not follow it, and tell the user.
- **MEDIUM: `remove` to turn a Board's Stage Prompt off.** Removing the Board entry falls back to the
  global one, which may be on. Use `prompt disable` to turn it off for that Board.
