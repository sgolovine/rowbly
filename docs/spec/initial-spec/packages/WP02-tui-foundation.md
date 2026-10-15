# WP02 — TUI Foundation

**Depends on:** WP00 · **Phase:** 1 (parallel with WP01)

## Goal

Build the Ink app shell and reusable primitives, so each later slice only has to compose screens (ADR-0006).

## Owns

`src/tui/index.ts`, `src/tui/app.tsx`, `src/tui/router/**`, `src/tui/components/**`, `src/tui/hooks/**`, `src/tui/keymap.ts`, `src/tui/screens/home/**`, `src/tui/screens/demo/**`, and their tests. Do not touch the per-area screen folders; they belong to later packages.

## Deliverables

1. **`startTui(ctx)`.** Renders `<App>` full-screen on the alternate screen buffer and restores the terminal on exit, including on crashes and SIGINT. If there is no Data Root, it routes to the `setup` screen registry entry, which WP08 fills in.
2. **Shell layout.**
   - A header with a breadcrumb (Workspace › Board › …) and Me.
   - The main area.
   - A footer with context-sensitive key hints.
   - A toast area for service warnings and errors. A `RowblyError` is shown as a toast and never crashes the app.
3. **Router.** A stack-based router: `push(screen, params)`, `pop()`, `replace()`. Screens are looked up through `screens/index.ts`.
4. **Global keymap** (`keymap.ts`):
   - `q` quits from the root (asks for confirmation when a form is dirty);
   - `esc` goes back;
   - `?` opens a help overlay listing the current keys;
   - `g` opens a go-to palette (Board, Stories, Epics, Workspaces, Boards, Assignees, Stages, Fields, Context);
   - `/` filters lists.

   Arrow keys and `j`/`k` both move.
5. **Primitives** (`components/`):
   - `SelectList`, with filtering, an empty state and multi-select mode;
   - `Form`, with text, multiline (opens `$EDITOR`), number, boolean, date, select and multiselect field kinds, inline validation messages from `ValidationError.details.issues`, and `ctrl+s`/enter to submit;
   - `ConfirmDialog`, used for destructive actions;
   - `DetailView` (key/value rows plus a markdown body rendered as plain text);
   - `Spinner`/`Loading`;
   - `StageBadge`, which uses the stage-category colours.
6. **Hooks.** `useServices()` (context-provided `Services`), `useAsync(fn, deps)` with loading/error/data states, and `useEditor()`. `useEditor()` suspends Ink, spawns `$VISUAL`/`$EDITOR` on a temp file, and resumes.
7. **Screens.**
   - `home`: a menu of the go-to destinations. WP09 later replaces this as the default with the board view.
   - `demo` (dev only, behind `ROWBLY_TUI_DEMO=1`): exercises every primitive so it can be screenshotted at Checkpoint A.

## Acceptance criteria

- [ ] `ink-testing-library` tests cover the router (push/pop/back on `esc`), `SelectList` filtering and multi-select, `Form` validation display and submit, and `ConfirmDialog` confirm and cancel.
- [ ] The editor hand-off is tested with `EDITOR` set to a script that writes known text. The form receives that text.
- [ ] A service error thrown in a screen shows a toast, and the app keeps running.
- [ ] The terminal is restored after `q` and after an injected crash (tested through the cleanup function).
- [ ] The demo screen renders all primitives. Attach a snapshot or screenshot to the PR.
