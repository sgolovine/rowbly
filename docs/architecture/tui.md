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
  hooks/            # contexts and hooks: focus, key capture, hints, layout, mouse, toasts, useAsync, refs
  testing/          # renderTui(): renders a component in TuiProviders for tests; keys for stdin
```

The screen areas in `screens/` are:

| Area          | Contents                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------ |
| `stories/`    | The Story list and rows, the new and edit Story modals, and the Story tabs (General, Specs, Attachments, Threads). |
| `stages/`     | The Stage form modal.                                                                                              |
| `onboarding/` | The onboarding steps in the Story panel. See [onboarding.md](onboarding.md).                                       |
| `settings/`   | The Settings modal and its sections, the AI section and the model picker.                                          |
| `factory/`    | The Factory controls modal and the factory status helpers.                                                         |

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
- Follow the React patterns of the
  [`rowbly-code-style` skill](../../.agents/skills/rowbly-code-style/SKILL.md#react-components):
  top-level handlers, one `env` object, and refs only through `src/tui/hooks/refs.ts`.

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
