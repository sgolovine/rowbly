# TUI

The TUI is one of the two thin front ends of Rowbly. It is a React app that Ink draws in the full
terminal. Screens call the same services as the CLI. The design system and the component library
are in the `rowbly-tui-design` skill. This page gives the structure of `src/tui/` and the rules for
its code.

Read this when you add or change a screen, a component, a hook, a key or a mouse action. Also read
the [`rowbly-tui-design` skill](../../.agents/skills/rowbly-tui-design/SKILL.md) before you change TUI
code.

## Start-up

1. `src/cli.ts` calls `renderTui()` from `src/tui/index.tsx` when there are no arguments.
2. `renderTui()` uses `runFullScreen()` from `terminal.ts`. This function turns on the alternate
   screen, mouse reports and the kitty keyboard protocol. It restores the terminal on exit, on
   signals and on crashes.
3. `App` (`app.tsx`) puts `TuiProviders` around the `Shell`. Keep `app.tsx` thin.
4. `renderTui()` waits until the user quits.

## Layout of `src/tui/`

```
src/tui/
  index.tsx         # renderTui(): mounts the Ink app and waits for exit
  app.tsx           # root TUI component: TuiProviders around the Shell
  tui-providers.tsx # the contexts every shared component reads; wrap the app in it
  terminal.ts       # runFullScreen(): alternate screen, mouse, kitty keys, terminal restore
  theme.ts          # the design tokens as hex values, and date formatting
  keymap.ts         # KeyHint, GLOBAL_KEYS, FORM_KEYS, moveDelta (arrows + j/k)
  mouse.ts          # MouseStdin: takes SGR mouse reports out of stdin before Ink reads it
  shell/            # the frame: Shell, Header, ProjectSwitcher, StoryFinder, HelpModal, factory button
  screens/          # one folder per area, see below
  components/       # the shared component library: one folder per component (barrel: components/index.ts)
  hooks/            # contexts and hooks: see the table of shared hooks below
  testing/          # renderTui(): renders a component in TuiProviders for tests; keys for stdin
```

The screen areas in `screens/` are:

| Area          | Contents                                                                                                                               |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `stories/`    | The Story list and rows, the new and edit Story forms of the Story sidebar, and the Story tabs (General, Specs, Attachments, Threads). |
| `stages/`     | The Stage form modal.                                                                                                                  |
| `onboarding/` | The onboarding steps in the Story panel. See [onboarding.md](onboarding.md).                                                           |
| `settings/`   | The Settings modal and its sections, the AI section and the model picker.                                                              |
| `factory/`    | The Factory controls modal and the factory status helpers.                                                                             |
| `threads/`    | The Factory view (the worker Threads of all Stories), its section headings and the Thread Modal.                                       |

## The Factory view

The right Panel of the shell has two view modes. The `stories` mode shows the Story list. It is the
default mode. The `threads` mode shows the Factory view. Rowbly does not save the view mode when it
quits.

- **The Switch.** The Factory group of the header has a `Switch` after the Factory Button. The
  Switch shows `Stories` (off) or `Threads` (on). A click on the Switch changes the view mode. A
  click on the `Factory` label opens the Factory controls. When the header is narrow, the Switch
  goes first. `ViewModeSwitch` and `headerFit` in `src/tui/shell/` control this.
- **The key `t`.** The key `t` changes the view mode when the shell is idle. The key `f` opens the
  Factory controls in the two modes. `GLOBAL_KEYS` and the help Modal list `t`.
- **The sections.** In the `threads` mode, the Panel has the title `Threads`. `FactoryView` shows
  the section "Active Threads" (`pending` and `running`) and the section "Inactive Threads"
  (`completed`, `failed`, `cancelled` and `interrupted`). Each heading shows `▾` or `▸`, the name and
  the count. `enter`, a click or `←/→` expands or collapses a section.
- **The rows.** Each row shows the Story id, the status, the Stage, the attempt, the model and the
  run time. The Threads in a section are newest first. Only worker Threads with a Story show.
  `groupThreads` in `src/services/thread/thread-groups.ts` makes the groups.
- **The filter.** The Stage sidebar stays. When you select a Stage, only the Threads with that
  `stage` show. "All Stages" shows all Threads.
- **The keys.** `↑/↓` and `j/k` move the selection. The Story keys (`n`, `d`, `shift+↑/↓` and
  `ctrl+shift+↑/↓`) do nothing in the Factory view. The sidebar keys do not change.
- **The Story sidebar.** The Story sidebar stays open when the view mode changes. It keeps its
  draft. `tab` gives it the focus in the two modes. **+ New Story** opens it also in the `threads`
  mode, but the `n` key does not.
- **Live data.** The view reads the Threads with `useAsync`. `useThreadChanges` reads them again
  when the factory writes a Thread file.

`enter` or a click on a Thread row opens the Thread Modal. The shell opens it as the `thread`
overlay. The title is `<story-id> › <thread name>`. The Modal shows `ThreadDetail` and the
`ConversationView` of the Thread. The conversation follows the new entries while the Thread is
`running`. The Modal is read-only. `esc` or the `✕` closes it, and the selection stays on the same
row.

## Code organization

- **One component per file.** Put each React component in its own dash-case `.tsx` file, with the
  name of the component. For example, the `StoryRow` component is in `story-row/story-row.tsx`. Do
  not add a new component to a file that exists. A small private helper (a constant or a pure
  function) can stay in the file of the only component that uses it.
- **One folder per component.** Put each component in its own folder, with its test and an
  `index.ts` that exports it:

  ```
  components/button/
    button.tsx
    button.test.tsx
    index.ts          # export * from "./button.js";
  ```

  A component imports a different component through the folder (`'../button/index.js'`). Add each
  component folder to `components/index.ts`. The dash-case `.ts` helpers stay in `components/`, with
  their tests next to them.
- **Group by area, with a barrel.** Each folder has an `index.ts` that exports the items that the
  other parts of the app use. Import from the folder (`'../components/index.js'`). Do not import from
  the files in a different folder.
  - `components/`: reusable UI parts.
  - `shell/`: the frame of the app: the shell, the header, the sidebars, the footer and the overlays.
  - `screens/<area>/`: the screens and their screen-specific parts. Register them in the `index.ts`
    of the area.
  - `hooks/`: contexts and hooks.
- Put each pure helper or constant that more than one file uses in its own dash-case `.ts` file, for
  example `components/shell-layout.ts`.
- Use the shared hooks before you write a new one. The table below gives each file of `hooks/`.
  Import the hooks from `hooks/index.ts`.
- Follow the React patterns of the
  [`rowbly-code-style` skill](../../.agents/skills/rowbly-code-style/SKILL.md#react-components):
  top-level handlers, one `env` object, and refs only through `src/tui/hooks/refs.ts`.

| File in `hooks/`        | Exports                                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------------------- |
| `layout.ts`             | `LayoutContext`, `useLayout`: the room of the main area or of a Modal.                             |
| `mouse.ts`              | `createMouseRegistry`, `MouseContext`, `useMouseSource`, `useMouse`, `WHEEL_LINES`.                |
| `refs.ts`               | `writeRef`, `useLatest`, `runExclusive`: the only writes to a React ref.                           |
| `section-shell.ts`      | `sectionShell`: the shell of a screen inside a different screen, with its own key hints.           |
| `shell.ts`              | `createShellRegistry`, focus (`useIsActive`), `useKeyCapture`, `useDirty`, `useKeyHints` and more. |
| `stop-on-abort.ts`      | `stopOnAbort`: stops a watch when the effect ends, also when the watch starts later.               |
| `toasts.ts`             | `createToastStore`, `showToast`, `useToast`, `useToasts`.                                          |
| `use-async.ts`          | `useAsync`: the loading, error and data states of a service call, and `refresh`.                   |
| `use-cursor.ts`         | `useCursor`: a cursor over rows, with the arrow keys and `j`/`k`.                                  |
| `use-escape.ts`         | `useEscape`: `esc` cancels the open form or dialog and does not close the screen.                  |
| `use-report-hints.ts`   | `useReportHints`: gives the key hints of a child to its parent when they change.                   |
| `use-story-changes.ts`  | `useStoryChanges`: calls a function when the files of the Stories change.                          |
| `use-story-paste.ts`    | `useStoryPaste`, `IMAGE_PASTE_HINT`: pastes clipboard images into the draft of a Story.            |
| `use-thread-changes.ts` | `useThreadChanges`, `useFactoryChanges`: call a function when Thread or factory files change.      |

## Story sidebar

The new Story form and the edit form of a Story show in the Story sidebar, not in a Modal. The Story
sidebar is a `Panel` on the right of the Story list (`shell/story-sidebar/`). The Story list stays
visible.

- `n`, **+ New Story**, `enter`, a click on a selected Story and a pick in the Story finder open the
  Story sidebar. The shell keeps the open form in `storyPane` (`use-shell.ts`).
- The top border shows `New Story` or `Edit <story-id>`, and a `✕` at its right end. The border is
  `accent` when the Story sidebar has the focus.
- `tab` in the Story list moves the focus to the Story sidebar. The order is the Stage sidebar, the
  Story list, then the Story sidebar. `shift+tab` in the Story list goes back. A click on a pane gives
  it the focus.
- In the Story sidebar, the form keeps its own keys. `esc` moves the focus to the Story list, and the
  form keeps its draft. In the Story list, `esc` closes the Story sidebar.
- When the form has unsaved text or images, Rowbly asks before it closes the form or shows a
  different form (`discardStory` overlay).
- A drag of the left edge changes the width (`ResizeEdge`). The default width is
  `STORY_SIDEBAR_WIDTH` of the terminal width. The minimum is `STORY_SIDEBAR_MIN_WIDTH`, and the Story
  list keeps `MAIN_MIN_WIDTH`. The width stays until Rowbly quits.
- Below `STACKED_BELOW_WIDTH`, the Story sidebar takes the full main area while it has the focus.
- `PaneBody` gives the form the contexts of a Modal body, so a `ConfirmDialog` of the form shows over
  the Story sidebar. The keys of the form go to the footer.

## Design rules in short

The [`rowbly-tui-design` skill](../../.agents/skills/rowbly-tui-design/SKILL.md) has the full rules,
the tokens (`tokens.json`), one guideline for each component (`components/*.md`) and HTML previews
(`previews/*.html`). The design language comes from Rowbly v1.

- **Build from the library.** `src/tui/components/` has Panel, Button, Modal, Form, SelectList,
  TextInput, TextArea, Tabs, Sidebar, toasts, KeyHints, MarkdownView and more. Use these components
  before you write a new component. Extend a component. Do not make a fork of it.
- **Tokens only.** Each colour comes from `theme` in `src/tui/theme.ts`. Do not write a hex value or
  an Ink colour name in a component. Do not use the `dimColor` of Ink. Use `theme.inkFaint`.
- **Focus is the only accent.** Only one region has the focus at a time. Its frame is `accent`, and
  all other frames are `border`. Gate each `useInput` on `useIsActive()`.
- **Each action has a key, and the key is visible.** Each control that you can click also has a key.
  Each screen declares its keys with `useKeyHints`. On each screen that can create a record, `n`
  creates the record and shows a `new …` hint.
- **The v1 screens are patterns, not code.** We did not port the Board, Story and Settings screens of
  v1. Their guidelines (`StoryCard`, `StageColumn`, `StoryModal`, `SettingsModal`, `Header`,
  `ListRow`) show how v1 used the library. Adapt them. The new UI can be different where the user
  asks for it.
- **Onboarding is not a Modal.** The onboarding steps show in the Story panel.

## Add a TUI feature

1. Write or extend the service first. See [service-layer.md](service-layer.md).
2. Put the screen or component in `src/tui/`, in the correct area folder.
3. Call the service from an event handler or from `useAsync`. `useAsync` records the loading, error
   and data states, and shows a toast if a call fails. Keep the loading, error and result states in
   the component.
4. For a change that comes from outside the TUI, use `refresh` from `useAsync`. It does not show a
   loading state or a toast. `useStoryChanges` and `useThreadChanges` call a function when the files
   change.
5. Declare the keys with `useKeyHints`.
6. Add or update the test of the component. See [testing.md](testing.md).
7. Examine the layout in a real terminal with the
   [`rowbly-screenshots` skill](../../.agents/skills/rowbly-screenshots/SKILL.md).

If a CLI command also uses a part of the logic, put that logic in the service, not in the component.

## Related

- [native-factory/controls.md](native-factory/controls.md): the keys of the Factory controls, the
  Threads tab and the AI section of Settings.
- [testing.md](testing.md): `renderTui()` and the keys for tests.
- [service-layer.md](service-layer.md): the errors that the TUI shows as toasts.
