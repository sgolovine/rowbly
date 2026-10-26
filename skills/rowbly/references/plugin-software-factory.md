# Software Factory Plugin

Every command below takes `--json --no-prompt`, and a remove also needs `--yes`.

A **Stage Prompt** is a Markdown file of instructions for an agent working on a Story in one Stage.
Every Stage, Backlog and Done included, can have one, and each is on or off (off by default). Stage
Prompts are set per Stage at the global level (`rowbly.config.json`) or on a Board
(`board.config.json`): a Board's entry for a Stage replaces the global entry for that Stage, and the
other Stages keep the global one. The Plugin is off until `rowbly plugins enable software-factory`.

`ROWBLY.md` describes how people work with the whole Data Root; a Stage Prompt is one Stage's
instructions. Read both before working a Story.

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

## Rules

- Follow a Stage Prompt only when `prompt.enabled` is `true`. It is true only when the setting is on
  (`configured`), `path` points inside the Plugin's folder for its level, and the file exists.
- `source` is `board`, `global` or `null` (no entry). Without `--board`, writes go to the current Board;
  `--level global` writes the global entry and cannot be combined with `--board`.
- Text comes from `--text`, `--file <path>` or `--file -` (stdin). Do not use `--edit`.
- `enable`, `disable` and `edit` exit 3 (`NOT_FOUND`) for a Stage that level does not have.
- A new Board entry made by `edit` starts with the global entry's on/off setting.

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

- **MEDIUM: reading `configured` as on.** A Stage Prompt whose file is gone has `configured: true` and
  `enabled: false`; do not follow it, and tell the user.
- **MEDIUM: `remove` to turn a Board's Stage Prompt off.** Removing the Board entry falls back to the
  global one, which may be on. Use `prompt disable` to turn it off for that Board.
