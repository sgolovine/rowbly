# ADR-0039: Stage Prompts are per-Stage settings with Markdown files in the Plugin's folder

**Status:** Accepted

## 1. Context

Agents that work a Board need instructions for each Stage: what to do with a Story in Todo, what
finishes one in Review. `ROWBLY.md` holds a Data Root's working agreements in one file that Rowbly
does not read. The Software Factory Built-in Plugin gives each Stage its own instructions, which a
person turns on or off per Stage and which one command hands to an agent with the Board's Stages.
Stages themselves follow the Configuration Cascade (ADR-0005): the most specific level that defines
a list replaces the levels above it. A Plugin's Board settings, read with `boardSettings`, deep-merge
the Board's bag over the Data Root's entry instead.

## 2. Decision

- A **Stage Prompt** is a Markdown file plus a setting `{ enabled, path? }`, keyed by Stage key, in
  the Plugin's settings: `stagePrompts` in the `software-factory` entry of `rowbly.config.json` (the
  global level) and in the `software-factory` bag of a Board's `board.config.json`. Every Stage,
  Backlog and Done included (ADR-0024), can have one; `enabled` is `false` by default.
- The cascade is per Stage key, not per list and not field by field: a Board's entry for a Stage
  replaces the global entry for that Stage, whole; a Stage without a Board entry uses the global
  one; otherwise it has none. The Plugin computes this from the raw entries rather than with
  `boardSettings`, whose deep merge would mix a Board's `enabled` with the global `path`. Global
  entries for Stages a Board does not have are not shown for that Board.
- A new Board entry created by saving text alone starts with the global entry's `enabled`, so
  editing a Board's copy of a prompt does not turn it off.
- Files live in the Plugin's folder for the level (ADR-0013): `plugins/software-factory/stage-prompts/<key>.md`
  and `boards/<board>/plugins/software-factory/stage-prompts/<key>.md`. `path` is stored relative
  to the Data Root, as doctor paths are. A path that does not point inside the Plugin's folder for
  its level is never read.
- A Stage Prompt is on for an agent only when all three hold: its setting is on, its path resolves,
  and the file exists. Turning one on without a file writes a template; turning one off keeps the
  file; removing one deletes the entry and the file at that level only. Doctor warns
  `SOFTWARE_FACTORY_MISSING_PROMPT` for an entry that is on without a readable file, and fixes
  nothing.
- `rowbly software-factory stages` returns every Stage of a Board with its effective Stage Prompt
  (setting, source level, path, whether the file exists, and its text) in one call.
- Plugins can read the global level fresh with `services.config.global()`, which returns the stored
  `rowbly.config.json` and the global (or default) Stages and Custom Fields. `settings` is read when
  the Plugin loads, and a Plugin had no other way to list the global Stages without a Board.

## 3. Rejected alternatives

- **A Board's Stage Prompts replace all global ones, like Stage lists.** A Board that wants its own
  prompt for one Stage would have to copy every other Stage's entry.
- **`boardSettings` deep merge.** It merges fields, so a Board entry `{ enabled: false }` would keep
  the global `path`, and the source of a Stage Prompt would be unclear.
- **Prompt text inside the configuration files.** Long Markdown in JSON is hard to read, edit and
  merge; a file per Stage Prompt can be opened in an editor and diffed.
- **Any path in the Data Root.** Plugin files are confined to the Plugin's folder (ADR-0013); reading
  other files would bypass that.
