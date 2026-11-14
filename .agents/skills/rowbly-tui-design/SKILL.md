---
name: rowbly-tui-design
description: >
  The Rowbly TUI design system and component library: colour, type and spacing tokens, layout
  rules, component guidelines and the shared Ink components in src/tui. Use this skill when you
  build, change or review any TUI screen, component, modal, form, list or key hint. Also use it
  when you choose a colour, border or spacing in src/tui.
---

# Rowbly TUI design system

The design system and its components come from Rowbly v1. The tokens, rules and shared components
are in this repository, and you can use them now. The v1 screens (Board, Story, Settings) were not
ported. Their guidelines below are patterns to adapt, not code to look for. The new UI can be
different from v1 if the user asks for it. Keep the tokens and principles unless the user changes
them.

- `tokens.json` contains every token, in two themes: `dark` (the default) and `light`.
  `src/tui/theme.ts` maps the tokens one time. Do not write a hex value or an Ink colour name in a
  component.
- `components/<Name>.md` is the guideline for each component.
- `previews/<Name>.html` shows each component in a browser. All previews use `previews/preview.css`.
  The previews are HTML mock-ups of terminal cells, not Ink output. Use the `rowbly-screenshots`
  skill to check the real screens.
- Rowbly v1's design system artifact has live previews:
  https://claude.ai/artifact/1fEvEjMXLyRwdsCS897cYu. It shows the v1 design. If this folder and the
  artifact do not agree, use this folder.

## Components

**Library** components are in `src/tui/components/`, and `src/tui/components/index.ts` exports
them. **Pattern** entries have a guideline (and a preview) but no code. Build each pattern from the
library parts that its row names. Follow the guideline of the pattern.

| Component | What it is | Status · code | Guide |
| --- | --- | --- | --- |
| `Button` | A clickable label with its key next to it in a key cap. Use it for header controls and for the `+ New …` bottom of a sidebar. It has no frame. | Library · `button.tsx` | [guide](components/button.md) · [preview](previews/button.html) |
| `ConfirmDialog` | The question and the `y`/`n` choices of a confirmation, in a `Modal`. It shows before an operation that you cannot undo. | Library · `confirm-dialog.tsx` | [guide](components/confirm-dialog.md) · [preview](previews/confirm-dialog.html) |
| `ContextMenu` | A list of items in a frame. A right click opens it at the pointer, on top of all other content. Each item names the key that does the same operation. | Pattern · not in the library | [guide](components/context-menu.md) |
| `DetailView` | Label–value rows for a record. | Library · `detail-view.tsx` | [guide](components/detail-view.md) · [preview](previews/detail-view.html) |
| `FormModal` | A generic `Modal` with one `Form`, to create or edit a record. `esc` and the `✕` close it. If the Form has changes, it asks before it discards them. | Library · `form-modal.tsx` | [guide](components/form.md) |
| `Form` | Fields with labels (text, multiline, number, boolean, switch, date, select, searchable select, multiselect) to create and edit a record, in a Modal. It shows the issues of a `ValidationError` under their fields. | Library · `form.tsx`, `field-row.tsx`, `field-value.tsx` | [guide](components/form.md) · [preview](previews/form.html) |
| `KeyHints` | The keys of the region in focus. It is the footer, and the strip at the bottom of a Modal. | Library · `key-hints.tsx`, `footer.tsx`, `help-overlay.tsx` | [guide](components/key-hints.md) · [preview](previews/key-hints.html) |
| `Modal` | The generic Modal: one short task on top of the screen (Forms, pickers, ConfirmDialog, Help). `size="screen"` makes a screen Modal. | Library · `modal.tsx`, `modal-frame.tsx` | [guide](components/modal.md) · [preview](previews/modal.html) |
| `Panel` | A region of the screen in a `border-round` frame, with its title in the top edge (`╭─Board───╮`). | Library · `panel.tsx` | [guide](components/panel.md) · [preview](previews/panel.html) |
| `SidebarList` | The rows of a sidebar, with a quiet Button at its bottom. Drag its right edge to change its size. An `editable` row shows a `✎` that edits the row when you click it. | Library · `sidebar.tsx`, `sidebar-item.tsx` | [guide](components/sidebar-list.md) · [preview](previews/sidebar-list.html) |
| `StageBadge` | A Stage name with its `●`. Its colour comes from its Stage Category: `stage-backlog`, `stage-board`, `stage-done`. | Library · `stage-badge.tsx` | [guide](components/stage-badge.md) · [preview](previews/stage-badge.html) |
| `Switch` | A track with a knob and the label of its state (`━━● Enabled`, `●── Disabled`). A click toggles it. In a `Form`, use the `switch` field kind. | Library · `switch.tsx` | [guide](components/switch.md) |
| `Tabs` | A row of tabs, for example the tabs of the detail view of a record. | Library · `tabs.tsx`, `tab.tsx` | [guide](components/tabs.md) · [preview](previews/tabs.html) |
| `Toast` | A short message at the bottom right after an operation. It goes away automatically (info 4 s, warning 6 s, error 8 s). Push one with `useToast()`. | Library · `toast-area.tsx`, `toast-line.tsx` | [guide](components/toast.md) · [preview](previews/toast.html) |
| `ViewSwitch` | The views of a screen on one line: `Stages / List v`. | Pattern · not in the library | [guide](components/view-switch.md) · [preview](previews/view-switch.html) |
| `BoardScreen` | The full Board screen of v1 at its default size: header, Boards sidebar, Board panel, footer. | Pattern · `Panel`, `Sidebar`, `Footer` | [preview](previews/board-screen.html) |
| `Header` | The header of v1: one Panel across the top, three rows high. The Buttons on the right go away when the width becomes smaller. | Pattern · `Panel`, `Button`, `ViewSwitch` | [guide](components/header.md) · [preview](previews/header.html) |
| `ListRow` | A row of a list view: a group heading or a record. | Pattern · `SelectionRow`, `StageBadge` | [guide](components/list-row.md) · [preview](previews/list-row.html) |
| `StageColumn` | One Stage on a Board: its name, a rule, then its Stories in Rank order. | Pattern · `StageBadge`, `StoryCard` | [guide](components/stage-column.md) · [preview](previews/stage-column.html) |
| `StoryCard` | A Story on a Board: three rows in a `border-round` frame. It uses `useMouse` for drag and drop. | Pattern · `Box` + `useMouse({ drag })` | [guide](components/story-card.md) · [preview](previews/story-card.html) |
| `StoryModal` | A screen Modal for one record: a header band, Tabs, and a body that scrolls. | Pattern · `Modal size="screen"`, `Tabs`, `ScrollBody` | [guide](components/story-modal.md) · [preview](previews/story-modal.html) |
| `SettingsModal` | A screen Modal with a section list on the left and the section on the right. | Pattern · `Modal size="screen"`, `SelectionRow`, `sectionShell` | [guide](components/settings-modal.md) · [preview](previews/settings-modal.html) |

The library also contains other code that has no guideline of its own:

| Code | What it is |
| --- | --- |
| `SelectList` | A list for the keyboard and the mouse: `↑/↓`/`j/k`, `/` filter, single or multi select. Its rows are `SelectListRow`. |
| `SelectionRow` | The `▌` bar and the `selection` fill of a highlighted row. Use them for lists that you lay out yourself. |
| `TextInput`, `TextArea` | Text fields for one line and for many lines, with a caret and paste. `TextArea` also opens full screen with `ctrl+f`. |
| `FullScreenEditor`, `useFullScreenEditor` | Markdown text on the full terminal, with View and Edit modes and an optional save. |
| `SearchableSelect`, `SearchableSelectPicker`, `fuzzySearch` | The fuzzy picker that a searchable select field opens. |
| `MarkdownView`, `markdown.ts` | Markdown that is rendered for the terminal (`marked-terminal`), in a viewport that scrolls. |
| `ScrollBody`, `useScrollFocus` | A viewport with limits. It scrolls with `pgup/pgdn` and the wheel, and it keeps the focused row in view. `active` controls the keys. `wheel` controls the wheel, and its default is `active`. |
| `Spinner`, `Loading` | The braille spinner, alone or with a label. |
| `CloseButton` | The clickable `✕` in the top edge of a Modal. |
| `OverlayHost` | Supplies `useMainOverlay()`, and draws the items that it opens. `TuiProviders` contains it. |
| `shell-layout.ts` | The sizes of the sidebar, the header and the footer. |

## How to use the library

- **Providers.** Wrap the app in `TuiProviders` (`src/tui/tui-providers.tsx`). It supplies toasts,
  the shell registry, the mouse registry, the terminal size as the layout, and the `OverlayHost`.
  Start the app full screen with `runFullScreen` (`src/tui/terminal.ts`). This function turns on
  mouse reports and the kitty keyboard protocol. It restores the terminal on exit, on signals and
  on crashes.
- **Focus and keys.** One region, and only one, is active at a time. Gate every `useInput` on
  `useIsActive()` and on your own focus state. Use `ActiveContext.Provider` to give a region its
  active state. A component that takes typed text or `esc` calls `useKeyCapture`. Before the shell
  acts on letters or `esc`, it checks `useContext(ShellContext).captured()`. `keymap.ts` has
  `moveDelta` (arrows and `j/k`), `FORM_KEYS` and `GLOBAL_KEYS`.
- **Key hints.** A screen declares its keys with `useKeyHints(...)` in a `ScreenDepthContext`
  provider. A Form in a
  Modal puts its own keys in the strip of the Modal automatically.
- **Size.** Components set their size from `useLayout()`. Supply a `LayoutContext` for each region,
  with the inner width and height of the region. Then Modals go to the centre of that region, and
  lists know their height. `height: undefined` means that the height increases with the content
  (for tests and piped output).
- **Modals.** Render a `Modal` at the location where the task opens. The Modal goes to the centre
  of the layout that contains it. In another Modal, it draws as a layer on top of the body of that
  Modal. When a Modal is open, take `esc` with `useKeyCapture(active, { text: false, escape: true })`.
  Close the Modal with `useEscape`.
- **Data and errors.** Call services from event handlers or from `useAsync`. Services throw
  `RowblyError` subclasses (`src/services/errors/errors.ts`). `useToast().error(err)` shows such an error
  with its hint. The `onSubmit` of a `Form` can throw a `ValidationError` with `details.issues`.
  Then the Form shows the messages under the fields.
- **Mouse.** `useMouse(ref, { onClick, onWheel, drag, onDrop, onPull })` makes a box
  respond to the pointer when the box is active. Every clickable control also has a key.

## Overview

Rowbly's TUI is a Kanban for the terminal, and its main input is the keyboard. The screen is a grid
of cells: one font, one size, approximately sixteen colours. The system came from the layout of
Rowbly v1: header strip, Boards sidebar, Board panel, footer of key hints, and modals over the
Board. The system adds rules to this layout, so that every screen looks like one product. The rules
below (principles, colour, type, space, modals, content, glyphs) apply to all new screens. The v1
layout is a reference, not a requirement.

## Principles

1. **Focus is the only thing in accent.** One region, and only one, is in focus at a time. Its
   frame and title are `accent`. All other items are `border` and `ink-muted`. There is one
   exception: the frame of the selected Story is also `accent`. Because of this, the Story is easy
   to see without a fill.
2. **Selection looks the same everywhere.** A highlighted row has the `▌` bar in `accent` and a
   `selection` fill, and its name is in `cell-title`. A Story on the Board has no fill; its frame
   changes to `accent` instead. Sidebar rows, settings sections, the Epics sidebar and list rows
   all use this look. A row keeps this look when its region loses focus, so you can always see the
   selection. The `accent` frame shows the focused region.
3. **Colour has a meaning.** Use the Stage Category colours (`stage-backlog`, `stage-board`,
   `stage-done`) only on the `●` dot and the Stage name. Use `danger` for errors and delete
   operations. `epic` is the colour of the `◆` glyph. Do not use colour for decoration.
4. **Weight and ink show the hierarchy, not size.** Use `ink` for content, `ink-muted` for labels,
   and `ink-faint` for hints and empty values. Do not use Ink's `dimColor`. Terminals render it in
   different ways, and some terminals do not render it. Use the tokens.
5. **Quiet chrome, loud content.** Frames are thin lines. The Story names are the brightest items
   on the Board.

## Colour

- In Ink, write a colour as the hex value of its token (`<Text color={theme.accent}>`). Get the
  value from the one `theme.ts` module that maps these tokens. Ink changes hex values to 256 or 16
  colours automatically. The note of each token names its 16-colour ANSI intent. Because of this, a
  16-colour terminal without `NO_COLOR` still shows the correct colours.
- Rowbly never paints `ground`. The background of the user's terminal shows through. Only these
  tokens are fills: `overlay` (Modals), `overlay-raised` (Modal header bands, Toasts), `field`,
  `field-focus` and `selection`.
- There are two themes. `theme.ts` selects the theme from the terminal background (`COLORFGBG`).
  **Dark terminal** is the default. **Light terminal** makes every hue darker, so that text keeps a
  contrast of ≥4.5:1 on a light background.
- Text pairs: in both themes, `ink`, `ink-muted` and `accent` have a contrast of ≥4.5:1 on
  `ground`, `overlay`, `field`, `field-focus` and `selection`. `ink-faint` has ≥4.5:1 on `ground`,
  `overlay` and `field`. Do not put `ink-faint` on `selection`.

## Type

Rowbly uses one font family: the font of the user's terminal (the previews use JetBrains Mono).
There are four styles, and all of them have one size:

- `cell-title` — bold. Story names in headers, Stage names in list view, the title of the panel in
  focus, and the name of the highlighted row.
- `cell-body` — regular. All other text.
- `cell-key` — bold `ink`: the key in a key hint.
- `cell-hint` — regular `ink-faint`: the description of the hint, and placeholders.

Letter case: use Title Case for the domain nouns (Board, Story, Stage, Epic, Story Key). Use
sentence case for all other text. Key hints are lowercase verbs: `enter open`, `m move Stage`.

## Space and frames

- `col-1`: one column of padding in every frame, and between a glyph and its text.
- `col-2`: two columns between Stage columns, between header groups and between key hints.
- `row-1`: one blank row between a Detail header and its Tabs, and between Form fields.
- `border-round` (`╭─╮`) is the frame for Panels, Modals and Stories. Header Buttons have no frame.
  Use `border-single` (`┌─┐`, `─`) only for rules.
- The title of a Panel is in its top edge (`╭─Boards──╮`). The title of a Modal is a breadcrumb:
  `Board › ROW-9`. The earlier crumbs are `ink-muted`, and the last crumb is `accent` bold.

## Reference layout (Rowbly v1)

```
╭────────────────────────────────────────────────────────────────────────────────────────╮
│ rowbly [D] | Rowbly · filter Epic: Test Epic 01    me —  Epics [\] | Settings [,] | Stages / List [v] | + New Story [n] │
╰────────────────────────────────────────────────────────────────────────────────────────╯
╭─Boards──╮ ╭─Board──────────────────────────────────────────────────────────────────────╮
│▌Rowbly  │ │ ● Backlog 1          ● In Progress 0        ● Done 8                         │
│         │ │ ━━━━━━━━━━━━━━━━━━━  ──────────────────     ──────────────────               │
│         │ │ ╭─────────────────╮  No Stories             ╭─────────────────╮              │
│         │ │ │ROW-9            │                         │ROW-1            │              │
│         │ │ │Test Story 01    │                         │Remove workspaces│              │
│         │ │ │◆ Test Epic 01   │                         ╰─────────────────╯              │
│ N new   │ │ ╰─────────────────╯                                                          │
╰─────────╯ ╰────────────────────────────────────────────────────────────────────────────╯
 ←→↑↓ select  enter open  n new Story  / filter  v list view                   ? help  q quit
```

- Header: one Panel, three rows.
  - The Data Root Button is at the far left, and it opens the Data Root switcher. The other Buttons
    are in the Panel, on the right.
  - Buttons have no frames. The label is in `ink`, then the key is in a key cap (` n ` on `keycap`,
    `ink-muted`; the diagram above shows it as `[n]`). Every Button that shows a key uses the same
    cap.
  - A `|` in `border-control` separates each control from the next control.
  - The view switch shows `Stages / List` and its key cap, with the current view in `accent` bold.
  - **+ New Story** is the one primary Button (`accent` bold).
  - A filter shows as `filter` (`ink-faint`), then its value (`ink`).
- Sidebars: a fixed width, a list of rows, and a quiet `+ New …` Button at the bottom. This Button
  is like the header Buttons: label in `ink`, key in a key cap, no frame.
- Footer: the key hints of the screen in focus are on the left. `? help` and `q quit` are always on
  the right.

A new layout can move or remove these regions. Keep the rules for regions: one Panel in focus, a
footer with the keys of the focused region, quiet header Buttons with key caps, and one primary
Button.

## Modals

There are two kinds of Modal, and no other kinds:

- **Screen Modals** — `StoryModal` and `SettingsModal`. A screen Modal is a full screen in a frame.
  It has a fixed size: the area of the Board panel minus one cell on each side, with a maximum of
  120 columns. It has a header band on `overlay-raised` and its own navigation (Tabs, or a section
  list). Its body scrolls independently. Only core opens screen Modals. The current shell shows a
  Story in the Story sidebar, a `Panel` beside the Story list, and not in a `StoryModal`.
- **Generic Modal** — `Modal`, for one short task: Forms, pickers (Move Stage), ConfirmDialog, Help,
  and all items that a Plugin opens. Its size comes from its content, from 48 to 72 columns. It has
  no band and no Tabs.

All Modals have the `overlay` fill, the `accent` frame, the breadcrumb title, the `✕` and the
`KeyHints` strip. An info modal is a generic Modal whose only key is `esc` (Help, or a Plugin
screen that only shows a result). An info modal shows a `Close` Button with the `esc` key cap in
place of the strip, on the same line.

A generic Modal can be on top of a screen Modal. The Modal on top has the focus, and the frame
below it changes to `border`. Never put a screen Modal on top of another screen Modal. If you open
Settings from a Story, the Story closes.

A `ContextMenu` is not a Modal. It has no title, no `✕` and no hint strip. It opens at the pointer,
not in the centre.

## Content

- An empty Stage shows `No Stories` in `ink-faint`, not `(empty)`.
- A value that is not set shows as `—` in `ink-faint`.
- Dates in the TUI show as `20 Oct 2026, 23:03`, in the time zone of the user. ISO timestamps stay
  in the `--json` output.
- The Epic on a Story shows its name (`Test Epic 01`), never its id (`test-epic-01`).
- If there are more Stories than the space can show, show `↓ 3 more` in `ink-faint` under the last
  Story.

## Glyphs

Rowbly does not use an icon font. It uses Unicode characters that all monospace fonts contain.

| Glyph | Meaning | Token |
| --- | --- | --- |
| `●` | Stage, with the colour of its Stage Category | `stage-*` |
| `◆` | Epic | `epic` |
| `▌` | highlighted row or Story | `accent`, in focus or not |
| `›` | Form field or list cursor | `accent` |
| `▾` `▸` | folded / open group in list view | `ink-faint` |
| `↑` `↓` | more above / below | `ink-faint` |
| `━` | rule under the Stage in focus | `accent` |
| `─` | rule under other Stages, hint strip | `border` |
| `·` | separator in one line | `ink-faint` |
| `✎` | edit the row (a Stage in the Stage sidebar) | `ink-faint`, `ink-muted` on the highlighted row |
| `—` | no value | `ink-faint` |
| `✓` `!` `✕` | Toast types: info, warning, error | `accent`, `stage-board`, `danger` |
| `▶` `✕` | Stage Run in progress / failed, in the badge of a Plugin card (plain text, no hue of its own) | the badge's ink |

## Add to the palette

Every screen uses these tokens, and never its own colours. A feature can own one hue for its glyph
(for example, the Epics feature owns `epic`). Ask the user before you add another hue. Put a new
token in `tokens.json`, in both themes, with its usage and ANSI intent. In the same change, add the
token to `src/tui/theme.ts`.
