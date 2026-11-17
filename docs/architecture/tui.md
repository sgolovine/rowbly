# TUI

The TUI is one of the two thin front ends of Rowbly. It is a React app that Ink draws in the full
terminal. Screens call the same services as the CLI. The design system and the component library
are in the `rowbly-tui-design` skill. This page gives the structure of `src/tui/` and the rules for
its code.

Read this when you add or change a screen, a component, a hook, a key or a mouse action. Also read
the [`rowbly-tui-design` skill](../../.agents/skills/rowbly-tui-design/SKILL.md) before you change TUI
code.

## Start-up

1. When there are no arguments, `src/cli-main.ts` loads `src/tui/index.tsx` with a dynamic `import()` and
   calls `renderTui()`. Other commands do not load the TUI.
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
  shell/            # the frame: Shell, Header, ProjectSwitcher, StoryFinder, HelpModal, factory and checks buttons
  screens/          # one folder per area, see below
  components/       # the shared component library: one folder per component (barrel: components/index.ts)
  hooks/            # contexts and hooks: see the table of shared hooks below
```

The screen areas in `screens/` are:

| Area          | Contents                                                                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stories/`    | The Story list and rows, the new and edit Story forms of the Story sidebar, and the Story tabs (General, Specs, Attachments, Threads, Models).                      |
| `stages/`     | The Stage form modal.                                                                                                                                               |
| `onboarding/` | The onboarding steps in the Story panel. See [onboarding.md](onboarding.md).                                                                                        |
| `settings/`   | The Settings modal and its sections, the Prompts section, the AI section, the Git section, the Hosts section, the model picker and the list of Stage worker models. |
| `factory/`    | The Factory controls modal and the factory status helpers.                                                                                                          |
| `threads/`    | The Factory view (the worker Threads of all Stories), its section headings and the Thread pane of the Story sidebar.                                                |

## The Factory controls

`f` opens the Factory controls, a generic Modal (`FactoryModal` in `src/tui/screens/factory/`). The
Modal has these views:

- **Main.** The overview, the `Attention` list, the queue and the buttons. `s` starts, `x` stops,
  `w` opens the warnings, `h` opens the history and `a` opens the AI settings. The overview has no
  model row. The `Attention` list shows a maximum of five rows. A click on a row selects the row: the
  row shows the `▌` bar and the selection fill. A click on the selected row opens the detail view of
  that warning. A click on a different row moves the selection and does not open a warning. If the
  selected warning goes away, no row stays selected. The `Attention` list has no keys.
  When the live factory status has a worker host (a `hosts` entry that is not `local`), a `Hosts`
  list shows above the `Attention` list. Each row shows the host id, the connection state, the used
  and the total slots (`<used>/<max>`) and, for a lost host, the last contact (`last contact <duration>
  ago` or `no contact`). A lost host has a state that is not `connected` or `degraded`. Its state is
  in `danger`. A `degraded` state is in `stage-board`. Without a worker host, the list does not show.
  `workerHosts` and `hostRow` in `src/tui/screens/factory/factory-hosts.tsx` make the rows. See
  [native-factory/remote-hosts.md](native-factory/remote-hosts.md) for an overview of the worker hosts.
- **Attention.** `Factory › Attention` lists all warnings in a `SelectList` with `clickToHighlight`.
  `↑/↓` selects, `enter` opens the detail view, `/` filters and `esc` goes back. A click on a row
  that is not highlighted highlights the row. A click on the highlighted row opens the detail view.
- **Warning detail.** `Factory › Attention › <title>` shows the full text with wrap, the kind, the
  Story and the related Thread. `o` opens the Story, `t` opens the Thread and `d` dismisses an
  attention entry. `esc` goes back.
- **History.** `Factory › Old supervisor Threads` lists the old supervisor Threads, the newest first.
  The factory does not create supervisor Threads now. `enter` shows the read-only conversation of the
  selected Thread (`FactoryOldThread`), and `esc` goes back to the list.

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

## The Hosts section of Settings

The Factory group of Settings has a Hosts section under the Git section (`HostsSection` in
`src/tui/screens/settings/hosts-section/`). The section shows the placement of new workers and the
worker hosts of the user. See [native-factory/remote-hosts.md](native-factory/remote-hosts.md) for an
overview of the worker hosts.

- The placement card at the top shows the `placement` value of the factory settings. A config
  without the `placement` key shows `prefer-local`. `p` opens a `FormModal` with the policies of
  `PLACEMENT_POLICIES`: `prefer-local`, `most-free` and `prefer-remote`. The section calls
  `updateFactorySettings({ placement })`.
- The list shows the hosts of `~/.rowblyrc.json`, in the order of the file. Each row shows the id,
  the SSH target, the worker limit, the switch for this Project, the switch for all Projects
  (`enabled`) and the last check. Before the first check, the row shows `not checked`.
- Without hosts, the section shows the command that adds a host:
  `rowbly host add <id> --ssh <target> --max-workers <n>`. The TUI does not add, remove or log in to
  a host. Use the CLI for these operations.
- A box under the list has the controls of the selected host. Each control has a key, and the
  mouse can also click it.

| Key   | Operation on the selected host                                            |
| ----- | ------------------------------------------------------------------------- |
| `↑/↓` | Select a host.                                                            |
| `u`   | Turn the host on or off for this Project (`useHost` or `unuseHost`).      |
| `e`   | Turn the host on or off for all Projects (`updateHost` with `enabled`).   |
| `w`   | Open a `FormModal` for the worker limit (`updateHost` with `maxWorkers`). |
| `c`   | Run the check (`checkHost`).                                              |

- `u` on a host that the Project does not use clones the Project into the managed folder on the
  host. The TUI does not use `--path`. The clone can take minutes. While it runs, the row shows a
  spinner, and the keys of the section stay available. Only one remote operation runs at a time.
- An error, for example `HOST_GIT_ACCESS`, or `CONFLICT` for an active Thread, shows its message and
  its hint in a toast. The list does not change.
- `c` runs the check with a spinner in the row. Then the section shows each item under the list,
  with its state, its detail and, for a `fail` or `warning` item, its action. The row shows the new
  last check.
- An incorrect worker limit shows the `VALIDATION` message under the field, and the file does not
  change.

The section gets its rows from `hostRows` of the `host-project` service. It calls only the `host`,
`host-project`, `host-check` and `factory-settings` services. When Settings or the section opens, the
section reads only local files. Only `u` and `c` open SSH. The section does not load Pi.

## The Stage sections

In All Stages, the Story list shows one section for each Stage. Each heading shows `▾` or `▸`.
`enter`, a click or `←/→` expands or collapses a section. When a Project opens, at the start or
after a Project switch, `useStageDefaults` in `src/tui/shell/shell/` collapses each Stage with
`expandedByDefault: false` in the config. `collapsedStageKeys` of the `stage` service gives these
keys. All other sections are expanded. A reload of the board does not change the sections. See
[storage.md](storage.md#stages).

## The order and the moves of Stories

In each Stage, the Story list shows the Stories in the order of their `updatedAt` times. The most
recent Story is at the top. See [storage.md](storage.md#position). You cannot change the place of a
Story in its Stage. `story-changes.ts` in `src/tui/shell/shell/` moves a Story to a different Stage:

- `shift+↓` (or `ctrl+shift+↓`) moves the Story of the cursor to the next Stage. `shift+↑` (or
  `ctrl+shift+↑`) moves it to the previous Stage. A move sets `updatedAt`, so the Story goes to the
  top of the new Stage. The selection stays on the Story.
- A drop of a dragged Story in a different Stage moves the Story to that Stage. A drop in the same
  Stage does nothing.

## The multi-selection of Stories

In the `stories` view mode, the user can select more than one Story and move all of them in one
step. The shell keeps the selection as a set of Story IDs, and the range anchor (a Story ID or
`null`). `src/tui/shell/shell/story-marks.ts` changes the selection.

- **The range mode.** `space` on a Story row starts the range mode. The Story of the cursor is the
  anchor. `↑/↓` and `j/k` move the cursor. Each Story row from the anchor to the cursor shows the
  mark. Stage heading rows are not selected. `space` again ends the mode, and the Story rows of the
  range stay selected. `esc` ends the mode and selects nothing. The range replaces the earlier
  selection.
- **The mouse.** `shift+click` on a Story row selects the Story rows from the cursor row to the
  clicked row, and moves the cursor to the clicked row. It does not open the Story sidebar. A click
  without `shift` clears the selection, then does its usual action. Many terminals keep
  `shift+click` for their own text selection. In these terminals, use the range mode.
- **The mark.** Each selected Story row shows `●` in `accent` at the left of its ID. The cursor row
  keeps its `▌` bar and its `selection` fill.
- **The move.** With a selection, `shift+↓` (or `J`) moves each selected Story to the Stage after
  its own Stage. `shift+↑` (or `K`) moves each selected Story to the Stage before its own Stage. A
  move sets `updatedAt`, so each Story goes to the top of its new Stage. A Story in the last Stage
  (for `shift+↓`) or in the first Stage (for `shift+↑`) does not move. The shell calls `updateStory`
  for one Story at a time, in the reverse list order. Thus each Story gets a later `updatedAt` than
  the Story below it, and the Stories keep their relative order. Then the shell puts the moved
  Stories on the board in memory, in the order of the writes. The target sections expand, and a Stage filter follows the first moved Story.
  The Stories stay selected, so the next `shift+↓` moves them one more Stage. If a move fails, the
  TUI shows the error as a toast and reloads the board. The Stories that moved stay moved.
- **No selection.** `shift+↑/↓` and `K/J` move the Story of the cursor to a different Stage, as before.
  `space` on a Stage heading expands or collapses the section.
- **Clear.** `esc` in the Story list clears the selection first. A second `esc` closes the Story
  sidebar. A Project switch clears the selection. After a reload, the IDs of Stories that do not
  exist go out of the selection.
- **The keys of a row.** `enter`, `d` and `n` act on the cursor row only.

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
- **The Checks Button.** When the live factory status has `checks` (`liveChecks` in
  `src/tui/screens/factory/check-jobs.ts`), the Factory group of the header has a `Checks` Button
  after the Switch, before the `|`. The note shows `<running>/<queued>` in `ink-muted`. When the
  header is narrow, the Checks Button goes first, before the Switch. `ChecksButton` and `headerFit`
  in `src/tui/shell/` control this.
- **The Checks Modal.** A click on the Checks Button or the key `c` opens the `checks` overlay. The
  key works only when the shell is idle and the Button condition is true. `ChecksModal` in
  `src/tui/screens/factory/checks-modal/` is a generic Modal. It reads the factory status that the
  shell already polls, so it updates when the factory writes its status. It shows the summary line
  of `checksText`, then one `SelectList` row for each running or queued job. `esc` or the `✕`
  closes it, and the focus goes back to the pane that had it. See
  [native-factory/controls.md](native-factory/controls.md#the-checks-view) for the rows.
- **The sections.** In the `threads` mode, the Panel has the title `Threads`. `FactoryView` shows
  the section "Active Threads" (`pending` and `running`) and the section "Inactive Threads"
  (`completed`, `failed`, `cancelled` and `interrupted`). Each heading shows `▾` or `▸`, the name and
  the count. One empty line separates the two sections. This line shows also when the section
  "Active Threads" is collapsed. You cannot select the empty line. `enter`, a click or `←/→`
  expands or collapses a section.
- **The rows.** Each row shows the Story id, the status, the Stage, the attempt and the run time.
  When `display.compactThreads` of the config is off, `ThreadRow` also shows the model, the creation
  time and the error or the summary of the result on two more lines. When it is on (the default),
  each Thread uses one line. A failed Thread shows `failed` in `danger` colour also in one line.
  The Threads tab of a Story uses the same setting. Settings › Display has a `Switch` for it. The Threads in a section are newest first. Only worker Threads with a Story show.
  `groupThreads` in `src/services/thread/thread-groups.ts` makes the groups.
- **The host column.** When the list has a remote Thread (`thread.host` is not `local`), each row
  shows the host of its Thread on the right, before the run time. Then a `local` Thread shows
  `local`. A list without remote Threads has no host column. The Threads tab of a Story uses the
  same rule.
- **A lost connection.** A `running` or `pending` remote Thread whose host has a lost connection in
  the live `hosts` list (`threadConnection`) shows `· connection lost (last contact <duration> ago)`
  or `· connection lost (no contact)` in `danger` on row 1. When the factory is not live, no Thread
  shows a lost connection. `threadHostView` and `threadHostProps` in
  `src/tui/screens/stories/thread-host-view.ts` give the props of `ThreadRow`. The Factory view uses
  the shared factory status of the shell.
- **An abandoned Thread.** An abandoned remote Thread (`isAbandoned`) shows `· abandoned` in
  `stage-board` on row 1. In the Threads tab of a Story, the text also gives the number of held
  entries, for example `· abandoned (3 held)`.
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
- The conversation shows JSON with syntax highlighting: the arguments of each tool call, and each tool
  result that is not an error and that starts with `{` or `[`. `jsonTokens` in
  `src/services/conversation/json-tokens.ts` finds the tokens. Keys are `accent`, strings are `ink`,
  numbers and literals are `ink-muted`, and punctuation is `ink-faint`.
- `ThreadPane` reads the Thread again when the worker writes its file (`useThreadChanges`).
- When the board has the Story of the Thread (`storyId`), the first row of `ThreadPane` shows an
  `Open Story` Button with the key `o`. A click on the Button, or `o` while the Thread has the focus,
  sets the view mode to `stories`. Then the Story list selects the Story row: it clears a Stage
  filter that hides the Story and expands its Stage section. The edit form of the Story replaces the
  Thread in the Story sidebar and gets the focus. The form opens on its General tab.
  `openThreadStory` in `src/tui/shell/shell/shell-selection.ts` does this. When the Thread has no
  `storyId`, or the board does not have the Story, the Button does not show and `o` does nothing.
- A running worker Thread shows `ThreadSteerInput` (`screens/stories/thread-steer-input/`) under
  the conversation. `m` or a click on the input gives it the focus. `enter` sends the text with
  `steerThread`, and `esc` gives the focus back to the Thread. While the input has the focus, `tab`,
  `o`, `esc` to the list and the conversation keys do not act. The Threads tab of a Story uses the
  same component, with the focus value `steer` of the tab. See
  [Steering input](native-factory/controls.md#steering-input).
- The Thread is read-only, except for the steering input, and it is never dirty. A Story form with unsaved changes asks before a
  Thread replaces it (`discardStory` overlay).
- In the Thread, `esc` gives the focus to the Thread list, and the Thread stays open. `tab` and
  `shift+tab` move the focus to the next or the previous pane. The footer shows the conversation
  keys, `m` (`message`) for a running worker Thread, `ctrl+f` (`full screen`), `o` (`open Story`) when the Button shows, and `esc`. In the Thread list, `esc` and the `✕` close the Thread. The selection stays on
  the same row.
- `ctrl+f` in the Thread shows the conversation over the whole terminal, in the same area as a
  `FullScreenEditor`. `useFullScreenConversation` (`components/use-full-screen-conversation.tsx`)
  opens a `FullScreenConversation` with `useMainOverlay()`. The border title is the title of the
  Story sidebar, `<story-id> › <thread name>`. The footer shows the conversation keys and
  `ctrl+f/esc` (`close`). The view is read-only. It starts at the newest entries, and it follows the
  new entries while the Thread is `running`. The scroll keys, `f` and the mouse wheel operate as in
  the small view.
- `ctrl+f`, `esc` or a click on the `✕` closes the full-screen view. The Thread keeps the focus and
  stays open. While the view is open, the panes below it take no keys and no wheel events.
- In the Threads tab of a Story, `ctrl+f` opens the same view when the Thread region has the focus
  and shows the conversation. Then `esc` closes only the view. The tab and the Modal stay open.
- The mouse wheel over the Thread list scrolls the list also when the Thread has the focus. The focus
  does not move. `pgup/pgdn` scroll only the pane that has the focus. While an overlay is open, the
  wheel does not scroll the list. `FactoryView` gives `wheel={clickable}` to its `ScrollBody`.
- The mouse wheel over the conversation of the Thread scrolls the conversation also when a different
  pane has the focus. The wheel gives the focus to the Story sidebar, as the wheel over the Story list
  gives the focus to the Story list. While an overlay or a confirmation covers the Story sidebar, the
  wheel does not scroll the conversation and the focus does not move. `ThreadPane` gives
  `wheel={clickable}` and `onWheelFocus` to its `ConversationView`. The keys of the conversation
  operate only while the Thread has the focus.
- `t` on a factory warning closes the Factory controls and opens the Thread in the Story sidebar
  (`openThread` of `OverlayHandlers`).

## Code organization

- **One component per file.** Put each React component in its own dash-case `.tsx` file, with the
  name of the component. For example, the `StoryRow` component is in `story-row/story-row.tsx`. Do
  not add a new component to a file that exists. A small private helper (a constant or a pure
  function) can stay in the file of the only component that uses it.
- **One folder per component.** Put each component in its own folder, with an `index.ts` that
  exports it:

  ```
  components/button/
    button.tsx
    index.ts          # export * from "./button.js";
  ```

  A component imports a different component through the folder (`'../button/index.js'`). Add each
  component folder to `components/index.ts`. The dash-case `.ts` helpers stay in `components/`.
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

| File in `hooks/`            | Exports                                                                                         |
| --------------------------- | ----------------------------------------------------------------------------------------------- |
| `layout.ts`                 | `LayoutContext`, `useLayout`: the room of the main area or of a Modal.                          |
| `mouse.ts`                  | `createMouseRegistry`, `MouseContext`, `useMouseSource`, `useMouse`, `WHEEL_LINES`.             |
| `refs.ts`                   | `writeRef`, `useLatest`, `runExclusive`: the only writes to a React ref.                        |
| `section-shell.ts`          | `sectionShell`: the shell of a screen inside a different screen, with its own key hints.        |
| `shell.ts`                  | `createShellRegistry`, focus (`useIsActive`), `useOverlayOpen`, `useKeyCapture`, `useKeyHints`. |
| `stop-on-abort.ts`          | `stopOnAbort`: stops a watch when the effect ends, also when the watch starts later.            |
| `toasts.ts`                 | `createToastStore`, `showToast`, `useToast`, `useToasts`.                                       |
| `use-async.ts`              | `useAsync`: the loading, error and data states of a service call, and `refresh`.                |
| `use-clock.ts`              | `useClock`: the time, which counts up each second only while it is enabled, for the run times.  |
| `use-cursor.ts`             | `useCursor`: a cursor over rows, with the arrow keys and `j`/`k`.                               |
| `use-escape.ts`             | `useEscape`: `esc` cancels the open form or dialog and does not close the screen.               |
| `use-report-hints.ts`       | `useReportHints`: gives the key hints of a child to its parent when they change.                |
| `use-story-changes.ts`      | `useStoryChanges`: calls a function when the files of the Stories change.                       |
| `use-story-paste.ts`        | `useStoryPaste`, `PASTE_HINT`: pastes a copied file or an image into the draft of a Story.      |
| `use-thread-changes.ts`     | `useThreadChanges`, `useFactoryChanges`: call a function when Thread or factory files change.   |
| `factory-status-context.ts` | `FactoryStatusContext`, `useSharedFactoryStatus`: the one factory status read of the shell.     |

The mouse registry measures only the boxes that want an event. It keeps each measured box in a cache.
`runFullScreen` emits `layout` on the mouse source after each frame that Ink draws. `useMouseSource`
then calls `registry.invalidate()`, and the registry clears the cache. A target that registers or
unregisters also clears the cache.

## Board load

`useShellData` loads the board. On the first load for a `ServiceContext`, before it reads the Stories, it
calls `repairDuplicateStoryIds`. The first load is the load after the start, after a Project switch, or
after the onboarding creates the Project. This service gives the newer Story of each duplicate Story ID
the next free number. The shell shows one info toast for each change, for example
`ROW-77 → ROW-79: duplicate ID`. If the repair fails, an error toast shows and the board loads. A reload
or a `useStoryChanges` refresh of the same Project does not repair. `rowbly doctor` reports a duplicate
ID that a different process makes later. See [Duplicate Story IDs](storage.md#duplicate-story-ids).

A Story action does not read the board. After a Story move, a move of the multi-selection, a delete or
a save in the Story sidebar, the shell changes the board in memory with `putOnBoard` or `takeFromBoard`.
These functions use `withStory` and `withoutStory` from `src/services/story/story-order.ts`. The moved
or saved Story goes to the top of its Stage, the same as after a full read. The watcher echo of the
write then reads the board one time. This read replaces the change in memory and also shows the changes
of the write to other Stories, for example the `dependsOn` cleanup of a delete. A Stage change and a
failed move of the multi-selection still read the board again with `reload`.

## Factory status

The shell reads the factory status one time for all views (`useShellData`). `Shell` gives this
status to the views in `FactoryStatusContext`. The header, the Factory controls, the Checks Modal, the
Factory view, the Story list and the Threads tab of a Story read the status from the shell. They do not read it again. Thus one write
of `runtime/status.json` causes one call of `getFactoryStatus`.

- `useFactoryChanges` reads the status again when `runtime/status.json` or `runtime/factory.lock`
  changes.
- A factory that stops without warning writes no file. Thus a timer also reads the status 5 s after
  the last read. Each read starts the timer again, also a read from a file event.
- The Threads tab reads its Threads again with `useThreadChanges`. A Thread file change does not read
  the status.
- Outside of the shell, for example in a test of the component, the Threads tab reads the status
  itself.

The TUI shows the connectivity of a live factory in three locations:

- **The Factory Button.** When the status of a live, `ready` factory has `connectivity: "offline"`,
  the Button shows `Factory offline`. When it has `connectivity: "degraded"`, the Button shows
  `Factory degraded`. This word replaces the worker counts (`factoryState`). `offline` is in `danger`
  and `degraded` is in `stage-board`. The other states stay in `ink-muted`. The `! n` problem count
  still shows. For `online`, or when the status has no `connectivity` field, the text does not change.
- **The Threads.** A Thread that is `failed` with the error class `transient` and the code `NETWORK`
  waits for the network (`threadWaitsForNetwork`). The factory resumes it. `ThreadRow` and the status
  line of `ThreadDetail` add `· waiting for network` in `stage-board`. This also applies to compact
  rows and to the Thread pane of the Story sidebar.
- **The queue reason.** Each queue entry of `status.json` has the `provider` of the worker model of its
  Story, when a model resolves. When this provider has a `network` pause in `providers`, `queueReason`
  gives `waiting for the network until <time>`. The Factory controls and the queue note of the Threads
  tab show this reason. A pause without `retryAt` gives `waiting for the network`.

## Story sidebar

The new Story form and the edit form of a Story show in the Story sidebar, not in a Modal. The Story
sidebar is a `Panel` on the right of the Story list (`shell/story-sidebar/`). The Story list stays
visible.

- `n`, **+ New Story**, `enter`, a click on a selected Story and a pick in the Story finder open the
  Story sidebar. The shell keeps the open form in `storyPane` (`use-shell-state.ts`). The Story
  sidebar also shows a Thread of the Factory view. See [The Factory view](#the-factory-view).
- The top border shows `New Story` or `Edit <story-id>`, and a `✕` at its right end. The border is
  `accent` when the Story sidebar has the focus.
- The top border also shows an expand button (`ExpandButton`) at the left of the `✕`: `⤢` when the
  Story sidebar has the regular width, and `⤡` when it is expanded. A click on the button and
  `ctrl+o` expand or collapse the Story sidebar. `ctrl+o` works in the Story list and in the Story
  sidebar while the Story sidebar is open.
- An expanded Story sidebar takes all the columns of the main area at the right of the Stage sidebar.
  The Story list does not show. When the Stage sidebar is hidden (`ctrl+b`), the Story sidebar takes
  the full width of the main area. The left edge does not drag while the Story sidebar is expanded.
  The shell keeps the state in `storyExpanded` (`use-shell-state.ts`), and `shellFrame` gives the
  sizes.
- The `display.storySidebar` option of the config sets the state when the Story sidebar opens from
  closed: `regular` (the default) opens it at the regular width, `expanded` opens it expanded, and
  `remember` opens it in the last state that the user selected while Rowbly runs. A different Story
  or Thread in an open Story sidebar keeps the current state. Settings › Display shows the option,
  and `w` or a click on the value selects the next value.
- `tab` in the Story list moves the focus to the Story sidebar. The order is the Stage sidebar, the
  tag sidebar (when it shows), the Story list, then the Story sidebar. `shift+tab` in the Story list goes back. A click on a pane gives
  it the focus. While the Story sidebar is expanded, `tab` and `shift+tab` do not go to the Story
  list, and `esc` in the Stage sidebar or the tag sidebar gives the focus to the Story sidebar.
- In the Story sidebar, the form keeps its own keys. `esc` moves the focus to the Story list, and the
  form keeps its draft. An expanded Story sidebar collapses before the Story list gets the focus. In
  the Story list, `esc` closes the Story sidebar.
- The mouse wheel over the Story list moves the cursor also when the Story sidebar has the focus. The
  wheel gives the focus to the Story list, and the Story sidebar stays open.
- When the form has unsaved text or images, Rowbly asks before it closes the form or shows a
  different form (`discardStory` overlay).
- A drag of the left edge changes the width (`ResizeEdge`). The default width is
  `STORY_SIDEBAR_WIDTH` of the terminal width. The minimum is `STORY_SIDEBAR_MIN_WIDTH`, and the Story
  list keeps `MAIN_MIN_WIDTH`. The width stays until Rowbly quits.
- Below `STACKED_BELOW_WIDTH`, the Story sidebar takes the full main area while it has the focus.
  The Story sidebar also takes the full main area when the narrowest Stage sidebar, Story list and
  Story sidebar do not fit. In this mode, the expand button does not show and `ctrl+o` does nothing.
- `PaneBody` gives the form the contexts of a Modal body, so a `ConfirmDialog` of the form shows over
  the Story sidebar. The keys of the form go to the footer.

## Story dependencies

The TUI shows and changes the `dependsOn` list of a Story. The pure functions of
`src/services/story-dependency/` give the rules. A component does not contain a blocked rule or a
cycle rule. `src/tui/screens/stories/story-dependency-view.ts` changes the results of these
functions into the data that the components show.

- **The `Depends on` field.** The new Story form and the General tab have a `Depends on` field. It
  is a `multiselect` field with `searchable: true` (`SearchableMultiSelect`). The field shows each
  upstream Story on one line as `<ID> <title>`, with a `✕` at its right. An empty list shows
  `none`. A `+ add` line is under the list.
- **The picker.** `enter`, typed text or a click on `+ add` opens a `SearchableSelectPicker` in a
  generic Modal (`Add Depends on`). Each choice has the label `<ID> <title>`. `enter` or a click adds
  the Story to the list. `dependencyCandidates` gives the choices. The picker does not show the Story
  itself, a Story that is already in the list, or a Story that makes a cycle. For a new Story, all
  Stories of the Project are choices. A Story in the last Stage is also a choice.
- **Removal.** `←/→` select an upstream Story, and `backspace` removes it. A click on `✕` also
  removes it. The form shows `enter add` and `backspace remove` in its key hints.
- **Save.** `ctrl+s` saves the form. The edit form gives `updateStory` the changes of the list as
  `addDependsOn` and `removeDependsOn`. If the list does not change, the form does not send these
  keys. The new Story form gives the list to `createStory` as `dependsOn`. A `ValidationError` of the
  service shows under the `Depends on` field, and nothing is saved.
- **The General tab lists.** Under the form, `StoryDependencyLists` shows the saved `Depends on` and
  `Blocks` lists of the Story. Each item shows the ID, the title and the `StageBadge` of the Stage.
  An empty list shows `none`. A click on an item opens that Story in the Story sidebar. The click
  uses `openThreadStory`: the Story list shows the Story and selects it, and the Story sidebar edits
  it. If the form has unsaved changes, the discard confirmation shows first. An item under the mouse
  shows the `selection` background. An item of an ID that the Project does not have has no title,
  and a click on it does nothing. The items take the clicks only while the General tab has the
  focus and no overlay or confirmation covers it. The lists are in the `ScrollBody` of the tab, thus
  the mouse wheel and `pgup/pgdn` scroll to all items of a long list. The lists do not change the
  dependencies. To change a `Blocks` item, edit the `Depends on` field of the downstream Story.
- **The Story times.** Under the lists, `StoryTimeRows` shows the `Created` and `Updated` times of
  the Story, in the time zone of `display.timeZone`, or in the system time zone when the config does
  not set it. A missing time shows `—`. Settings › Display shows the time zone, and `e` edits it in a
  Form. An empty value removes the setting. The other dates of the TUI keep the system time zone.
- **The blocked mark.** `storyListRows` gives each Story row its `waitingFor` IDs. The function uses
  all Stories of the Project, also when a Stage filter hides some of them. A Story row with one or
  more of these IDs is blocked, and it shows `⊘` in `ink-muted` on the right, before the other slots. The mark shows in
  all Stages. When all upstream Stories are in the last Stage, the mark goes away after the board
  reads the Stories again.
- **The `waiting for` text.** A blocked Story in a work Stage (the `board` Stage Category) with no
  factory activity shows `waiting for ROW-01, ROW-02` in the activity slot, in `ink-muted`. The text
  shows a maximum of three IDs, then `+<count>`. If the row is narrow, the text is cut. When a worker
  is active, the slot shows `▶ <agent>`. A worker on a worker host shows `▶ <agent> @<host>`, for
  example `▶ opus @ws1`. When that host has a lost connection in the live `hosts` list of the shared
  factory status (`hostLost`), the slot adds `connection lost` in `danger`. A worker on `local` shows
  only the agent.

## Story tags

The TUI shows and changes the tags of the Project and the tags of each Story. The tag service
(`src/services/tag/tag.ts`), `createStory` and `updateStory` give the rules. A component does not
contain a tag rule. `src/tui/screens/stories/story-tag-view.ts` changes the tags into the data that
the components show.

- **The Tags section.** Settings has a Tags section in the Project group, after Custom Fields
  (`TagsSection`). It shows each tag of `listTags` in config order, with its label and its value in
  two columns. With no tags, it shows `No Tags. Press n to add one.`
- **Add.** `n` or the `+ New Tag` Button opens `TagFormModal` with the `Label` and `Value` fields.
  The save calls `addTag`. An error of the service shows under its field or as a toast, and the
  Modal stays open.
- **Edit.** `enter`, `e` or a click on a row opens `TagFormModal` with only the `Label` field. The
  title shows the value, for example `Edit Tag › frontend`. The value cannot change. The save calls
  `updateTag`.
- **Remove.** `d` opens a destructive `ConfirmDialog`. The message tells that Rowbly also removes
  the tag from each Story. The confirmation calls `removeTag`.
- **Reload.** After each change, the section reads the tags again and calls `onChange()`. Then the
  Story list and the Story forms show the new tags.
- **The `Tags` field.** The new Story form and the General tab have a `Tags` field after
  `Depends on`. It is a `multiselect` field. Its options are the tag values, and each option shows
  the tag label. A Story value that is not a tag of the Project shows as its value, and the user can
  remove it. When the Project has no tags, the field does not show.
- **Save.** The new Story form gives the list to `createStory` as `tags`. The edit form gives the
  full list to `updateStory` as `tags`, only when the list changes. An empty list removes the `tags`
  key from the Story file.
- **The tag slot.** A Story row with tags shows the labels of its tags after the title, in
  `ink-muted`, in the order of the Story. A value that is not a tag of the Project shows as its
  value. If the row is narrow, the tag slot is cut before the title. A Story without tags has no tag
  slot.

## The tag sidebar

When the Project has one or more tags, the left sidebar has two Panels in one column. The Stage
sidebar ("Stages") is at the top. The tag sidebar ("Tags") is below it. When the Project has no
tags, only the Stage sidebar shows. `src/tui/shell/shell/` contains the code.

- **The entries.** The first entry is "All Tags". Then each tag of `projectTags` shows with its
  label, in config order. The tag sidebar has no button. Add, edit and remove the tags in Settings.
- **The filter.** The shell keeps the value of the selected tag in `tagKey` (`null` for All Tags).
  "All Tags" is selected at the start. `shellRows` shows only the Stories whose `tags` include the
  value. The tag filter and the Stage filter apply together. The Factory view ignores the tag
  filter.
- **The title.** While a tag is selected, the title of the Story panel is
  `<project> › <Stage label or All Stages> › <tag label>`. An empty list shows
  `No Stories with the tag <label>.`, or `No Stories in <Stage> with the tag <label>.`
- **The keys.** `tab` moves the focus in this order: the Stage sidebar, the tag sidebar, the Story
  list, the Story sidebar. `shift+tab` goes in the opposite order. In the tag sidebar, `↑/↓` and
  `j/k` select the previous or next entry, and `esc` gives the focus to the Story list. The Stage
  keys (`n`, `e`, `shift+↑/↓`) do nothing in the tag sidebar. `[`/`]` change the Stage filter from
  all panes. The footer and the help Modal show the keys of the tag sidebar.
- **The mouse.** A click in the tag sidebar gives it the focus. A click on an entry selects it. When
  the entries do not fit, the wheel selects.
- **The size.** The tag sidebar has the width of the Stage sidebar. A drag of the right edge of the
  Stage sidebar changes the width of the two sidebars. Beside the list, the tag sidebar gets the
  rows for all its entries, but not more than half of the main area. The Stage sidebar gets the
  other rows. In a narrow terminal, the two sidebars go above the Story list, one above the other,
  and the Story list keeps at least half of the main area. `ctrl+b` hides and shows the two
  sidebars together.
- **Changes.** When the selected tag is removed in Settings, the filter acts as "All Tags". When the
  last tag is removed, the tag sidebar does not show, and the Story list gets the focus. When a
  Story opens from the Story finder, from a Thread or from a dependency link, or after a save, a tag
  filter that hides the Story goes back to "All Tags". A Project switch resets the filter to
  "All Tags". A new Story does not get the selected tag.

## Worker model overrides

A person can see, set and remove the worker model overrides of the factory settings in the TUI. The
factory uses the Story override, then the Stage override, then the worker model. The TUI writes
the overrides only through `setWorkerOverride` in `src/services/factory-settings/`. The manager
reads the factory settings again on each pass, so a change applies to the next worker without a
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
- The tab reads the models only when the person opens the tab for the first time. Until the models
  load, the tab shows `Loading models…`. If Pi cannot load, an error toast shows. The `source` prop
  (default `piWorkerSource()`, the Pi worker) lets a test replace Pi.
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
   loading state or a toast, and it does not render when it starts. `useStoryChanges` and
   `useThreadChanges` call a function when the files change. For a poll, give `useAsync` an `isEqual`
   option. Then a read that gives the same data does not render again.
5. For a run time that counts up, use `useClock(enabled)`. Enable it only while the view shows a
   running Thread and no full-screen view, Modal or main overlay (`useOverlayOpen()`) covers it.
6. Declare the keys with `useKeyHints`.
7. Examine the layout in a real terminal with the
   [`rowbly-screenshots` skill](../../.agents/skills/rowbly-screenshots/SKILL.md).

If a CLI command also uses a part of the logic, put that logic in the service, not in the component.

## Related

- [native-factory/controls.md](native-factory/controls.md): the keys of the Factory controls, the
  Threads tab and the AI section of Settings.
- [service-layer.md](service-layer.md): the errors that the TUI shows as toasts.
