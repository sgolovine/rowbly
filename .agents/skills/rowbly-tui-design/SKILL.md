---
name: rowbly-tui-design
description: >
  The Rowbly TUI design system: colour, type and spacing tokens, layout rules and component
  guidelines for the Ink TUI in src/tui. Use when building, changing or reviewing any TUI screen,
  component, modal, key hint or Plugin screen, or when choosing a colour, border or spacing in src/tui.
---

# Rowbly TUI design system

**Status: implemented.** `src/tui/theme.ts` maps the dark and light palettes. Shared controls,
Board views, shell, Story and Settings frames, and Built-in Plugin screens use the tokens. Preserve
user-facing keys unless a rule here changes them. Real-terminal evidence is required when changing
layout; the HTML previews show the design intent.

- `tokens.json` holds every token (two themes: `dark`, the default, and `light`). Map them in one
  `src/tui/theme.ts`; never write a hex value or an Ink colour name in a component.
- `components/<Name>.md` is the guideline for each component.
- `previews/<Name>.html` shows each component in a browser (they share `previews/preview.css`). They
  are HTML mock-ups of terminal cells, not Ink output: check real screens with the
  `rowbly-screenshots` skill.
- The same system, with live previews, is published as a design system artifact:
  https://claude.ai/artifact/1fEvEjMXLyRwdsCS897cYu. This folder is the copy in the repository; when
  the two differ, change both.

## Components

| Component | What it is | Files |
| --- | --- | --- |
| `BoardScreen` | The whole Board screen at its default size: header, Boards sidebar, Board panel, footer. | [preview](previews/BoardScreen.html) |
| `Button` | A clickable label with its key beside it in a key cap: the header controls and the `+ New …` foot of each sidebar. No frame of its own. | [guide](components/Button.md) · [preview](previews/Button.html) |
| `ConfirmDialog` | A small Modal that asks before an Operation that cannot be undone. | [guide](components/ConfirmDialog.md) · [preview](previews/ConfirmDialog.html) |
| `DetailView` | Label–value rows for a record, used by the Details tab and by settings screens. | [guide](components/DetailView.md) · [preview](previews/DetailView.html) |
| `Form` | Labelled fields for creating and editing a record, inside a Modal. | [guide](components/Form.md) · [preview](previews/Form.html) |
| `Header` | One Panel across the top, three rows tall, titled with the project folder. | [guide](components/Header.md) · [preview](previews/Header.html) |
| `KeyHints` | The keys of the screen in focus: the footer, and the strip at the bottom of a Modal. | [guide](components/KeyHints.md) · [preview](previews/KeyHints.html) |
| `ListRow` | A row of the Board's list view: a Stage heading or a Story. | [guide](components/ListRow.md) · [preview](previews/ListRow.html) |
| `Modal` | The generic Modal: one short task over the screen. New Board, New Story and edit Forms, Move Stage and other pickers, ConfirmDialog, Help, and every Plugin Modal. | [guide](components/Modal.md) · [preview](previews/Modal.html) |
| `Panel` | A region of the screen, framed by `border-round` with its title set into the top edge (`╭─Board───╮`). | [guide](components/Panel.md) · [preview](previews/Panel.html) |
| `SettingsModal` | A screen Modal: the settings, opened with `,`. A section list on the left, the section on the right. | [guide](components/SettingsModal.md) · [preview](previews/SettingsModal.html) |
| `SidebarList` | The rows of a sidebar: Boards, the Epics Plugin Sidebar, the settings sections. | [guide](components/SidebarList.md) · [preview](previews/SidebarList.html) |
| `StageBadge` | A Stage name with its `●`, coloured by Stage Category: `stage-backlog`, `stage-board`, `stage-done`. | [guide](components/StageBadge.md) · [preview](previews/StageBadge.html) |
| `StageColumn` | One Stage on the Board: its name, a rule, then its Stories in Rank order. | [guide](components/StageColumn.md) · [preview](previews/StageColumn.html) |
| `StoryCard` | A Story on the Board: three rows inside a `border-round` frame. Never wraps; long names are cut with `…`. | [guide](components/StoryCard.md) · [preview](previews/StoryCard.html) |
| `StoryModal` | A screen Modal: one Story, opened with `enter` from the Board or the list view. It is a screen in a frame, not a task. | [guide](components/StoryModal.md) · [preview](previews/StoryModal.html) |
| `Tabs` | The tabs of a Story's Detail view (Details, and a tab per Plugin: Comments, Tasks). | [guide](components/Tabs.md) · [preview](previews/Tabs.html) |
| `Toast` | A short message bottom-right after an Operation, that goes away on its own (info 4 s, warning 6 s, error 8 s). | [guide](components/Toast.md) · [preview](previews/Toast.html) |
| `ViewSwitch` | The Board's two views on one line: `Stages / List v`. | [guide](components/ViewSwitch.md) · [preview](previews/ViewSwitch.html) |

## Overview

Rowbly's TUI is a keyboard-first Kanban for the terminal. The screen is a grid of cells: one font, one size, sixteen-ish colours. This system keeps the current layout — header strip, Boards sidebar, Board panel, footer of key hints, modals over the Board — and gives it rules so every screen and every Plugin looks like one product.

## Principles

1. **Focus is the only thing in accent.** Exactly one region is in focus at a time; its frame and title are `accent`. Everything else is `border` and `ink-muted`. The selected Story's frame is the one exception: it is `accent` too, so the Story stands out without a fill.
2. **Selection looks the same everywhere.** A highlighted row gets the `▌` bar in `accent` and a `selection` fill, with its name in `cell-title`; a Story on the Board has no fill: its frame turns `accent` instead. Sidebar rows, settings sections, the Epics sidebar and list rows all use it. It keeps that look when the region loses focus, so you can always see what is selected; the focused region is shown by its `accent` frame.
3. **Colour means something.** The Stage Category colours (`stage-backlog`, `stage-board`, `stage-done`) go on the `●` dot and the Stage name only. `danger` is for errors and deletes. `epic` is the `◆` glyph. Nothing is coloured for decoration.
4. **Hierarchy is weight and ink, not size.** `ink` for content, `ink-muted` for labels, `ink-faint` for hints and empty values. Do not use Ink's `dimColor`: terminals render it differently (some not at all). Use the tokens.
5. **Quiet chrome, loud content.** Frames are hairlines. The Story names are the brightest thing on the Board.

## Colour

- Write colours as the token's hex in Ink (`<Text color={theme.accent}>`), from one `theme.ts` module that maps these tokens. Ink downsamples hex to 256 or 16 colours on its own; each token's note names the 16-colour ANSI intent so a `NO_COLOR`-free 16-colour terminal still reads right.
- Rowbly never paints `ground`. The user's terminal background shows through. Only `overlay` (Modals), `overlay-raised` (Modal header bands, Toasts), `field`, `field-focus` and `selection` are fills.
- Two themes, picked from the terminal background (`COLORFGBG`; an explicit `tui.theme` setting is planned): **Dark terminal** is the default, **Light terminal** darkens every hue so text keeps ≥4.5:1 on a pale background.
- Text pairs: `ink`, `ink-muted` and `accent` are ≥4.5:1 on `ground`, `overlay`, `field`, `field-focus` and `selection` in both themes. `ink-faint` is ≥4.5:1 on `ground`, `overlay` and `field`; do not put it on `selection`.

## Type

One family (the user's terminal font; previews use JetBrains Mono). Four styles, all one size:

- `cell-title` — bold. Story names in headers, Stage names in list view, the panel title in focus, the highlighted row's name.
- `cell-body` — regular. Everything else.
- `cell-key` — bold `ink`: the key in a key hint.
- `cell-hint` — regular `ink-faint`: the hint's description, placeholders.

Casing: Title Case for the domain nouns (Board, Story, Stage, Epic, Story Key), sentence case for everything else. Key hints are lowercase verbs: `enter open`, `m move Stage`.

## Space and frames

- `col-1`: one column of padding inside every frame, and between a glyph and its text.
- `col-2`: two columns between Stage columns, between header groups and between key hints.
- `row-1`: one blank row between a Detail header and its Tabs, between Form fields.
- `border-round` (`╭─╮`) is the frame for Panels, Modals and Stories. Header Buttons have no frame. `border-single` (`┌─┐`, `─`) is for rules only.
- A Panel's title sits in its top edge (`╭─Boards──╮`). A Modal's title is a breadcrumb: `Board › ROW-9`, earlier crumbs `ink-muted`, the last `accent` bold.

## Layout (kept as today)

```
╭─rowbly─────────────────────────────────────────────────────────────────────────────────╮
│ Rowbly · filter Epic: Test Epic 01    me —  Epics [\] | Settings [,] | Stages / List [v] | + New Story [n] │
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

- Header: one Panel, three rows, with the Buttons inside it on the right. Buttons have no frames: label in `ink`, then the key in a key cap (` n ` on `keycap`, `ink-muted`; drawn `[n]` above; every Button that shows a key uses the same cap), every control separated by `|` in `border-control`. The view switch reads `Stages / List` and its key cap, the current view in `accent` bold. **+ New Story** is the one primary Button (`accent` bold). A filter shows as `filter` (`ink-faint`) then its value (`ink`).
- Sidebars: fixed width, a list of rows, a quiet `+ New …` Button at the bottom (label `ink`, key in a key cap, no frame), like the header Buttons.
- Footer: key hints for the screen in focus on the left; `? help` and `q quit` pinned right.

## Modals

Two kinds, and nothing else:

- **Screen Modals** — `StoryModal` and `SettingsModal`. A whole screen in a frame: fixed size (the Board panel's area less one cell each side, at most 120 columns), a header band on `overlay-raised`, their own navigation (Tabs, or a section list), a body that scrolls on its own. Only core opens them.
- **Generic Modal** — `Modal`, for one short task: Forms, pickers (Move Stage), ConfirmDialog, Help, and everything a Plugin opens. Sized to its content, 48–72 columns, no band, no Tabs.

All Modals share the `overlay` fill, the `accent` frame, the breadcrumb title, the `✕` and the `KeyHints` strip. A generic Modal can stack on a screen Modal; the one on top has the focus and the frame below drops to `border`. Never stack two screen Modals: opening Settings from a Story closes the Story.

## Content

- An empty Stage says `No Stories` in `ink-faint`, not `(empty)`.
- Missing values are `—` in `ink-faint`.
- Dates in the TUI read `20 Oct 2026, 23:03` in the user's time zone. ISO timestamps stay in `--json` output.
- The Epic on a Story shows its name (`Test Epic 01`), never its id (`test-epic-01`).
- More Stories than fit: `↓ 3 more` in `ink-faint`, under the last Story.

## Glyphs

No icon font; Rowbly uses Unicode that every monospace font has.

| Glyph | Meaning | Token |
| --- | --- | --- |
| `●` | Stage, coloured by Stage Category | `stage-*` |
| `◆` | Epic | `epic` |
| `▌` | highlighted row or Story | `accent`, in focus or not |
| `›` | Form field or list cursor | `accent` |
| `▾` `▸` | folded / open group in list view | `ink-faint` |
| `↑` `↓` | more above / below | `ink-faint` |
| `━` | rule under the Stage in focus | `accent` |
| `─` | rule under other Stages, hint strip | `border` |
| `·` | separator inside one line | `ink-faint` |
| `—` | no value | `ink-faint` |
| `✓` `!` `✕` | Toast kinds info, warning, error | `accent`, `stage-board`, `danger` |

## For Plugins

A Plugin's screens and Sidebars use these components and tokens through the Plugin API, never their own colours. A Plugin may own one hue for its glyph (Epics owns `epic`); ask before adding another.
