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

| Area          | Contents                                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `stories/`    | The Story list and rows, the new and edit Story forms of the Story sidebar, and the Story tabs (General, Specs, Attachments, Threads, Models).   |
| `stages/`     | The Stage form modal.                                                                                                                            |
| `onboarding/` | The onboarding steps in the Story panel. See [onboarding.md](onboarding.md).                                                                     |
| `settings/`   | The Settings modal and its sections, the Prompts section, the AI section, the Git section, the model picker and the list of Stage worker models. |
| `factory/`    | The Factory controls modal and the factory status helpers.                                                                                       |
| `threads/`    | The Factory view (the worker Threads of all Stories), its section headings and the Thread pane of the Story sidebar.                             |

## The Factory controls

`f` opens the Factory controls, a generic Modal (`FactoryModal` in `src/tui/screens/factory/`). The
Modal has these views:

- **Main.** The overview, the `Attention` list, the queue and the buttons. `s` starts, `x` stops,
  `enter` opens the supervisor, `w` opens the warnings, `h` opens the history and `a` opens the AI
  settings. The `Attention` list shows a maximum of five rows. A click on a row selects the row: the
  row shows the `▌` bar and the selection fill. A click on the selected row opens the detail view of
  that warning. A click on a different row moves the selection and does not open a warning. If the
  selected warning goes away, no row stays selected. The `Attention` list has no keys.
- **Attention.** `Factory › Attention` lists all warnings in a `SelectList` with `clickToHighlight`.
  `↑/↓` selects, `enter` opens the detail view, `/` filters and `esc` goes back. A click on a row
  that is not highlighted highlights the row. A click on the highlighted row opens the detail view.
- **Warning detail.** `Factory › Attention › <title>` shows the full text with wrap, the kind, the
  Story and the related Thread. `o` opens the Story, `t` opens the Thread and `d` dismisses an
  attention entry. `esc` goes back.
- **Supervisor** and **History.** The conversation and the history of the supervisor.

`factoryProblems` in `factory-status.ts` makes the warnings. Each warning has a kind: `heartbeat`,
`attention`, `issue` or `provider`. Only an `attention` warning can be dismissed. The shell gives the
Modal the Stories of the board and the callbacks `onOpenStory` and `onOpenThread`. See
[native-factory/controls.md](native-factory/controls.md) for the keys.

## The Git section of Settings

The Factory group of Settings has a Git section under the AI section (`GitSection` in
`src/tui/screens/settings/git-section/`). The section shows the Git settings of the canonical
checkout. These settings are in the `git` section of the `factory` key of
`.rowbly/rowbly.config.json`.

The section has five cards. Each card shows the current value. If the value is not set, the card
shows the default.

| Card           | Key | Default                                            |
| -------------- | --- | -------------------------------------------------- |
| Commit author  | `a` | `Git config identity`                              |
| Commit message | `m` | `chore(rowbly): record project changes after scan` |
| Periodic push  | `p` | `off`                                              |
| Periodic pull  | `u` | `off`                                              |
| Sync interval  | `i` | `300 seconds`                                      |

- `a`, `m` and `i` open a `FormModal` for the value. The author has the form `Name <email>`.
- An empty author or an empty message removes the value. Then the factory uses the default.
- The interval must be a whole number from 60 to 86400. The form shows an incorrect value under the
  field, and the file does not change.
- `p` and `u` turn push and pull on or off immediately.
- Each card has a Button that does the same operation as its key.

The section calls `configureGit` of the `factory-settings` service. The `rowbly factory configure`
command uses the same Git rules. The section does not load Pi or `agent-auth`.

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

`enter` or a click on a Thread row opens the Thread in the Story sidebar, not in a Modal. The Thread
list and the Thread show at the same time. The shell keeps the Thread in `storyPane` as
`{ kind: "thread", thread }` (a `SidePane`). The Thread uses the frame, the size, the focus and the
keys of the Story sidebar. Only one Story or Thread shows in the Story sidebar at a time.

- The title in the top border is `<story-id> › <thread name>`.
- `ThreadPane` (`screens/threads/thread-pane/`) shows `ThreadDetail` and the `ConversationView` of
  the Thread. Its size comes from the body of the Story sidebar. In a short body, the detail is
  compact. The conversation follows the new entries while the Thread is `running`.
- `ThreadPane` reads the Thread again when the worker writes its file (`useThreadChanges`).
- The Thread is read-only, and it is never dirty. A Story form with unsaved changes asks before a
  Thread replaces it (`discardStory` overlay).
- In the Thread, `esc` gives the focus to the Thread list, and the Thread stays open. `tab` and
  `shift+tab` move the focus to the next or the previous pane. The footer shows the conversation
  keys and `esc`. In the Thread list, `esc` and the `✕` close the Thread. The selection stays on
  the same row.
- `t` on a factory warning closes the Factory controls and opens the Thread in the Story sidebar
  (`openThread` of `OverlayHandlers`).

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
  Story sidebar. The shell keeps the open form in `storyPane` (`use-shell-state.ts`). The Story
  sidebar also shows a Thread of the Factory view. See [The Factory view](#the-factory-view).
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

## Worker model overrides

A person can see, set and remove the worker model overrides of the factory settings in the TUI. The
factory uses the Story override, then the Stage override, then the worker model. The TUI writes
the overrides only through `setWorkerOverride` in `src/services/factory-settings/`. The supervisor
reads the factory settings again on each turn, so a change applies to the next worker without a
restart.

Both places use `ModelPickerModal` (`settings/model-picker-modal/`) and `StageModelList`
(`settings/stage-model-list/`). `StageModelList` shows one row for each Stage of the Project, in
board order. Each row has the `StageBadge` of the Stage and a model text. The list shows all Stages,
also disabled Stages.

The first option of the picker of an override is `No override`, not `Pi default`. Use the
`defaultLabel` prop of `ModelPickerModal` for this label. When you select `No override`, the
override goes away. A map that becomes empty goes away from the factory settings. The other keys of
the factory settings and of the config do not change. If the save fails, the error shows as a toast,
and the picker stays open.

### The Stage overrides in Settings

The Models tab of the AI section shows the list under the `Worker model` card. A row shows the
override of the Stage as `provider/model · thinking <level>`, or `Worker model` when the Stage has
no override.

- `↑/↓` select a Stage. `enter` or a click opens the picker when Pi has loaded.
- The title of the picker is `AI › Worker model › <Stage label>`. The current override is selected.
- A save writes `stageWorkerModels[<stage key>]`, shows an info toast and closes the picker.

### The Story overrides in the Story sidebar

The `Models` tab is the last tab of a Story, after the `Threads` tab (`stories/models-tab/`). A row
shows the Story override for the Stage. When the Story has no override for the Stage, the row shows
the model that applies and its source, for example `Stage model: openai/gpt-sol` or
`Worker model: Pi default`.

- `↑/↓` select a Stage. `enter` or a click opens the picker when the models have loaded.
- The title of the picker is `<Story ID> › Model › <Stage label>`.
- A save writes `storyWorkerModels[<story id>][<stage key>]`. `No override` removes that entry. When
  the Story has no other override, the Story key also goes away.
- The tab loads Pi only when the person opens the tab for the first time. Until the models load, the
  tab shows `Loading models…`. If Pi cannot load, an error toast shows. The `loadRuntime` prop
  (default `authRuntime`) lets a test replace Pi.
- While the picker is open, the tab tells the Story sidebar. Then `esc` closes the picker, not the
  Story sidebar. `shift+tab` and `esc` work as on the other tabs when the picker is closed.

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
