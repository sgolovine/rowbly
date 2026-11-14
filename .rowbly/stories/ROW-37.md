---
title: Make threads tab compact
stage: IN_REVIEW
position: 2
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-37
pull_request: https://github.com/sgolovine/rowbly/pull/230
---

## Goal

Each Thread in the Threads view (the Factory view, `━━● Threads`) uses three lines: the status line, a line with the model id and the creation time, and a line with the summary of the result. The list is long, and the user can see only a few Threads at a time. See the attached screenshot: the second and the third lines are marked.

The result: a compact mode shows each Thread on one line (the status line only). The user can turn the compact mode on and off in Settings.

## Scope

In scope:

- A compact mode of `ThreadRow`: only row 1 (Story id, status glyph and text, attempt, Stage name and run time on the right). Rows 2 and 3 do not show.
- The compact mode applies to the Factory view (`FactoryView`) and to the Threads tab of a Story (`ThreadListPanel`), because both use `ThreadRow`.
- A project setting that turns the compact mode on or off, stored in `.rowbly/rowbly.config.json`.
- A new Settings section that shows the setting as a `Switch`.
- A `rowbly project update` flag for the setting.
- Tests for the config and project service changes, and doc updates.

Not in scope:

- Changes to the Thread detail pane (`ThreadPane`, `ThreadDetail`).
- Other display options (for example, a choice of which fields show).
- A per-user setting in `~/.rowblyrc.json`.

## Acceptance criteria

- [ ] `.rowbly/rowbly.config.json` accepts an optional `display` object with the boolean key `compactThreads`. `readConfig` keeps the key, and `writeConfig` writes it. A config test examines this.
- [ ] A `display` value that is not an object, an unknown key in `display`, or a `compactThreads` value that is not a boolean gives a config issue at the correct path. A config test examines this.
- [ ] If `display.compactThreads` is not set, the compact mode is on.
- [ ] `updateProject({ display: { compactThreads: false } })` writes the value and keeps all other config keys (`features`, `skills`, `factory`). A project test examines this.
- [ ] `rowbly project update --compact-threads <on|off> --json` changes the value and returns the Project. Another value gives a `VALIDATION` error or a Commander error.
- [ ] With the compact mode on, each Thread in the Factory view and in the Story Threads tab uses one line. The model, the creation time, the error and the summary do not show. A failed Thread still shows `failed` in `danger` colour on its line. (A person examines this in a real terminal.)
- [ ] With the compact mode off, `ThreadRow` shows the same three rows as before. (A person examines this.)
- [ ] Settings has a new section with a `Switch` for the compact mode. `space`, `enter` or a click toggles it, a toast shows the new state, and the open Threads view changes without a restart. (A person examines this.)
- [ ] Keys, selection, the scroll (`pgup`/`pgdn`) and the click on a row work in both modes in the Factory view. (A person examines this.)
- [ ] `docs/architecture/storage.md` (the config shape), `docs/architecture/cli.md` (the new flag) and `docs/architecture/tui.md` (if it describes the Thread row) tell about the setting, in STE.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- Row component: `src/tui/screens/stories/thread-row/thread-row.tsx`. Add a `compact?: boolean` prop. When `compact` is true, render only the first `Box` (row 1). Update the JSDoc.
- Users of `ThreadRow`: `src/tui/screens/threads/factory-view/factory-view.tsx` and `src/tui/screens/stories/thread-list-panel/thread-list-panel.tsx`. Pass the value from the Project config. The Project data is available in the shell (`src/tui/shell/shell/use-shell-data.ts`, `story-panel.tsx`); pass it down as a prop, or read it with `getProject(ctx)` in the hook of the view. Settings calls `onChange()` after a change, so that the screens behind Settings read the Project again. Make sure the Threads view gets the new value after `onChange()`.
- Config types: `src/services/config/config-types.ts`. Add `display?: DisplayConfig` to `ProjectConfig`, with `interface DisplayConfig { compactThreads?: boolean }`.
- Config validation: `src/services/config/config-issues.ts`. Add `displayIssues(raw.display)`, the same pattern as `featuresIssues`.
- Config normalization: `src/services/config/config.ts` (near line 48–58) copies only known keys. Add `display` there, or it is lost on the next write.
- Add a helper, for example `compactThreads(config): boolean` in `config.ts`, that returns `config.display?.compactThreads !== false`.
- Project service: `src/services/project/project.ts`. Add `display?: DisplayConfig` to `UpdateProjectInput` and merge it as `features` is merged in `updateProject`. Update `project.test.ts` and `config.test.ts`.
- CLI: the `project update` command in `src/commands/`. Add `--compact-threads <on|off>`, the same pattern as `--specs <on|off>`. The command calls `updateProject` only; no domain logic in the command.
- Settings: add a section to `SETTINGS_GROUPS` in `src/tui/screens/settings/settings-sections.ts`, in the "Project" group, with `id: "display"`, `label: "Display"` and a one-line description. Copy the pattern of `src/tui/screens/settings/specs-section/specs-section.tsx` (`Switch`, `useKeyHints`, `useInput`, toast, `onChange`). Use dash-case folder `display-section/` with an `index.ts`.
- Read `.agents/skills/rowbly-code-style/SKILL.md` and `.agents/skills/rowbly-tui-design/SKILL.md` before the change. Use only `theme` colours. Do not write TUI tests.
- `doctor` reads the config through the same validation. Make sure an existing config without `display` gives no new issue.

## Assumptions

- "The threads tab" is the Threads view (`FactoryView`) of the screenshot. The compact mode also applies to the Threads tab of a Story. Reason: both use the same `ThreadRow` component, and one setting for both keeps the code simple.
- The compact mode removes rows 2 and 3 (model and time, error or summary), not only row 2. Reason: the screenshot marks both lines, and the goal is a compact list. The Thread detail pane still shows all the data.
- The compact mode is on by default. Reason: the author asked to make the tab compact; the setting lets a user get the old layout back.
- The setting is a Project setting in `.rowbly/rowbly.config.json`, under a new `display` key. Reason: all existing Settings sections change the Project config, and a per-user setting in `~/.rowblyrc.json` needs a new service and has more risk (see the safety rules for that file). `features` is not used, because it holds optional features, not display options.
- The CLI gets a `--compact-threads <on|off>` flag. Reason: the Rowbly rule is that the CLI and the TUI call the same services; the flag is small and agrees with `--specs <on|off>`.
