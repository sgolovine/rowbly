---
title: Expand and collapse the Story sidebar
stage: DONE
position: 74
uid: 712bb8e0-bfaf-487f-914f-f88e10e25a32
createdAt: 2026-11-16T18:36:13.319Z
updatedAt: 2026-11-16T19:34:45.797Z
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-77
pull_request: https://github.com/sgolovine/rowbly/pull/261
---

The Story sidebar (the panel on the right that shows a Story form or a Thread) must have a button that expands it to the full width of the main area, and collapses it again.

## Goal

The Story sidebar is narrow (40% of the terminal by default), so long Story descriptions and Thread conversations are hard to read. The user can expand the Story sidebar so that it covers the Story list. The Stage sidebar stays visible (see the attached screenshot `image-20261116-1832.png`, "Expanded View"). The user can collapse it again to the regular width. A Project setting controls the state in which the Story sidebar opens.

## Scope

In scope:

- An expand/collapse button in the top border of the Story sidebar, at the left of the `✕` close button. Both buttons stay visible when the Story sidebar is expanded.
- A keyboard shortcut that does the same as the button (the TUI design rule: each clickable control also has a key).
- The expanded layout: the Story sidebar takes all the columns of the main area at the right of the Stage sidebar. The Story list does not show. If the Stage sidebar is hidden (`ctrl+b`), the Story sidebar takes the full width of the main area.
- A new display option of the Project, "Story sidebar" with 3 values: `regular` (default: open at the regular width), `expanded` (always open expanded) and `remember` (open in the last state that the user selected).
- The option in the Display section of the Settings, and in `rowbly.config.json` (`display.storySidebar`).
- The applicable documentation.

Not in scope:

- A `rowbly project update` CLI flag for the new option.
- A change to the narrow-terminal behaviour (below `STACKED_BELOW_WIDTH`, or when the sidebars do not fit, the Story sidebar already covers the full main area).
- Persistence of the `remember` state after Rowbly quits.

## Acceptance criteria

- [ ] `DisplayConfig` in `src/services/config/config-types.ts` has an optional `storySidebar` key with the values `"regular" | "expanded" | "remember"`. `DISPLAY_OPTIONS` includes it.
- [ ] `configIssues` gives an issue for a `display.storySidebar` value that is not one of the 3 values. A test in `src/services/config/config.test.ts` examines this.
- [ ] A new function in `src/services/config/config.ts` (for example `storySidebarBehavior(config)`) gives `"regular"` when the config does not set the value. A test examines the default and each value.
- [ ] `updateProject({ display: { storySidebar } })` saves the value and keeps the other display options. A test in `src/services/project/project.test.ts` examines this.
- [ ] `shellFrame` (`src/tui/shell/shell/shell-frame.ts`) accepts an expanded flag. When the Story sidebar is `beside` and expanded, the Story sidebar width is `layout.width - shownWidth - gap`, the Story list is not shown and the resize edge does not drag. A unit test of `shellFrame` examines the widths with and without the Stage sidebar. (`shell-frame.ts` is a pure function. Put the test next to it as `shell-frame.test.ts`.)
- [ ] In the TUI, the top border of the Story sidebar shows an expand icon (for example ` ⤢ `) at the left of ` ✕ ` in the regular state, and a collapse icon (for example ` ⤡ `) in the expanded state. A click toggles the state. (A person examines this, with the `rowbly-screenshots` skill.)
- [ ] `ctrl+o` toggles the state while the Story sidebar is open, from the Story list and from the Story sidebar. `GLOBAL_KEYS` in `src/tui/keymap.ts` lists the key, so the help overlay shows it. (A person examines this.)
- [ ] When the Story sidebar is in the full-cover mode of a narrow terminal, the expand/collapse icon does not show and `ctrl+o` does nothing. (A person examines this.)
- [ ] With `regular`, each new open of the Story sidebar (from closed) is at the regular width. With `expanded`, each new open is expanded. With `remember`, each new open uses the last state that the user selected in this TUI process (regular at start). A change between Stories while the Story sidebar stays open keeps the current state with all 3 values. (A person examines this.)
- [ ] The Display section of the Settings shows the "Story sidebar" option with its current value and lets the user change it with a key and with the mouse. The key hints show the key. (A person examines this.)
- [ ] `docs/architecture/tui.md` (section "Story sidebar"), `docs/architecture/storage.md` (display options) and the `GLOBAL_KEYS` help text describe the button, the key and the option, in ASD-STE100 STE.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- Story sidebar component: `src/tui/shell/story-sidebar/story-sidebar.tsx`. It renders a `Panel` with `aside={<CloseButton … />}`. Put the new button in the `aside` beside `CloseButton` (a `Box` with both). Make a small library component (for example `src/tui/components/expand-button/`) on the model of `close-button`, and export it from `src/tui/components/index.ts`. Use only `theme` colours (`theme.inkFaint`, as the `✕`). Use characters that take one terminal column.
- Shell state: `src/tui/shell/shell/use-shell-state.ts` keeps `storyPane` and `storyWidth` in memory. Add the expanded state (and the last selection for `remember`) there.
- Layout: `src/tui/shell/shell/shell-frame.ts`. `storyModeOf` gives `"closed" | "beside" | "full"`. `"full"` is the narrow-terminal cover mode, which also hides the Stage sidebar. The new expanded state applies only to `"beside"`. It keeps the Stage sidebar and gives the Story sidebar the columns of the Story list. `shell.tsx` and `shell-props.ts` must not render the Story list when it has no columns. Set `onResize` to `undefined` while expanded (`shell-props.ts`, near line 174).
- Focus: while expanded, the Story list is not on the screen. `tab`/`shift+tab` (`shell-keys.ts`, the pane list near line 107) must skip the Story list. `esc` in the Story sidebar moves the focus to the Story list today. While expanded, `esc` collapses the Story sidebar first and gives the focus to the Story list. The mouse wheel rule for the Story list does not apply while the list is hidden.
- Open rule: apply the setting where `storyPane` changes from `null` to a pane. The shell already reads `compactThreads(board.project)` in `shell-props.ts` (near line 103), so read the new option from `board.project` in the same way.
- Keys: `ctrl+o` is not used in `src/tui`. `ctrl+a`/`ctrl+e` are text-editing keys and `ctrl+f` is the full-screen text editor, so do not use them. Handle `ctrl+o` in `ctrlKey` of `src/tui/shell/shell/shell-keys.ts`, and add it to the footer hints of the Story sidebar (`story-sidebar-view.ts`, `storySidebarHints`) as `ctrl+o expand` / `ctrl+o collapse`.
- Settings: `src/tui/screens/settings/display-section/display-section.tsx`. It uses `updateProject({ display: … })`. `space` toggles compact Threads and `e` edits the time zone. Add a row "Story sidebar" with the value (`Regular`, `Expanded`, `Remember last`). Use the `w` key to go to the next value (the key is free in this section), and make a click on the value do the same. Call `onChange` after the save so the shell reads the new value.
- Config validation: `displayOptionIssues` in `src/services/config/config-issues.ts`. The `rowbly project` CLI `describe` output in `src/commands/project/project.ts` can show the value, but a new flag is not in scope.
- Rules: services do not import `ink` or `react`. Do not write TUI tests. Read the `rowbly-code-style` and `rowbly-tui-design` skills before the change.

## Assumptions

- The "fullscreen" state covers the Story list only, and the Stage sidebar and header stay visible. Reason: the screenshot "Expanded View" marks the area at the right of the Stage sidebar, and the description says "besides the sidebar".
- "Follow previous" remembers the last state only until Rowbly quits, and starts as regular. Reason: smallest scope. Persistence needs a write to the committed `rowbly.config.json` or to `~/.rowblyrc.json` on each toggle, and the existing width of the Story sidebar also lasts only until Rowbly quits.
- The preference is a Project display option in `rowbly.config.json` (`display.storySidebar`), in the Display section of the Settings. Reason: the other TUI preferences (`compactThreads`, `timeZone`) are there.
- The values are named `regular`, `expanded` and `remember`. Reason: short names that match the three options of the author.
- The shortcut is `ctrl+o`. Reason: the TUI design rule needs a key for each clickable control, and `ctrl+o` is not used. The `ctrl` key works also while a text field has the focus.
- In the narrow-terminal cover mode, the button does not show. Reason: the Story sidebar already covers the full main area in that mode.
- `esc` in an expanded Story sidebar collapses it and gives the focus to the Story list. Reason: the Story list must be visible when it has the focus.
- No CLI flag for the option. Reason: the author asks for a setting in the Settings, and the smallest scope is the TUI. A person can add the flag later.
- The Story is not split. Reason: the config option, the layout change and the Settings row are small and depend on each other, so one pull request can hold them.
