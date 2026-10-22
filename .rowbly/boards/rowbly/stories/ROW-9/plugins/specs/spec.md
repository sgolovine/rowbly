# Right-click context menu foundation

## Goal

Allow TUI elements to respond to a mouse right click through shared infrastructure. Demonstrate the foundation with a Story actions menu on the Board, so later work can add menus to other elements without reimplementing terminal input or dispatch.

This is proposed behavior for ROW-9, based on its description. The initial integration and menu contents below define a bounded first delivery; the description does not enumerate every future menu target.

## Current behavior

`src/tui/mouse.ts` extracts SGR terminal mouse reports before passing ordinary input to Ink. It currently emits left-button presses and releases and pointer movement; right-button presses and releases are discarded. `src/tui/hooks/mouse.ts` registers element bounds and dispatches clicks, hover, dragging and sidebar resizing. Story cards and Story rows already register mouse targets.

## Scope

- Extend the existing parser and mouse registry with distinct right-button handling and an optional context-menu handler on registered elements.
- Provide a reusable action menu using the existing generic `Modal`, selection controls, focus handling and theme tokens.
- Enable it for Story cards in Stages view and Story rows in List view.
- Offer **Open Story** and **Edit Story**, using the same navigation paths as `enter` and `e` for that Story.

Menus for Boards, Stages, sidebar entries, fields and Plugin records, Plugin menu contributions, destructive actions, submenus and new terminal protocols are outside this first delivery. No new CLI commands, data formats or stored preferences are needed.

## Input and dispatch requirements

1. Preserve the button identity of SGR presses and releases, including modifier-bearing right-button reports. Keep zero-based terminal cell coordinates and support reports split across input chunks.
2. Consume complete mouse reports before forwarding remaining text to Ink. Middle-button and wheel reports must not invoke a context action or be mistaken for a left click.
3. Expose an optional handler, such as `onContextMenu(x, y)`, through `useMouse`. Existing callers that only supply left-click, hover, drag or resize handlers retain their behavior.
4. On a right-button press, invoke the handler once for the smallest active registered target containing the pointer that supplies that handler, using the registry's existing hit-testing convention. A release does not invoke it again.
5. A right click must not invoke `onClick`, start a drag or resize, or complete a pending left-button drop. Cancel any pending drag/resize and its preview when opening a menu.
6. Unregistered, inactive and unmounted targets cannot open a menu. A right click on blank Board space does nothing.

## Menu behavior

- Right-clicking a Story selects that Story and opens a menu titled with its Story Key. Actions always refer to the clicked Story, even if another Story was previously selected.
- The first enabled action is highlighted. Arrow keys or `j`/`k` change the highlighted action; `enter` or a left click activates it exactly once.
- `esc` and the shared close control dismiss the menu without executing an action. Dismissal returns focus to the Board with the clicked Story selected.
- While open, the menu owns input. Board shortcuts, clicks, dragging and sidebar resizing do not run through it. Further right clicks behind it do nothing.
- Close the menu before opening the selected Story or its edit form. Do not stack a menu over the destination screen.
- Reuse the generic centered Modal for this delivery, with existing sizing, clipping, selection styling and key hints. Pointer-anchored positioning and outside-click dismissal are deferred; they must not require a new overlay system for this foundation.
- Keyboard-only navigation and the existing `enter` and `e` actions continue working. Terminals that do not deliver right-button SGR reports remain usable through those keys. Native terminal menus or terminal-specific mouse overrides are outside Rowbly's control.

## Code and documentation boundaries

Keep parsing in `src/tui/mouse.ts`, target registration and dispatch in `src/tui/hooks/mouse.ts`, reusable menu UI in `src/tui/components/`, and Story-specific actions in `src/tui/screens/board/`. Follow folder barrels, one component per file, existing active-layer handling and the TUI design skill. Keep `app.tsx` thin and preserve accepted ADRs.

When implemented, document supported targets, menu actions, dismissal and terminal limitations in `docs/user-guide.md` and `skills/rowbly/references/tui.md`. Do not describe this proposed feature as already built before implementation.

## Acceptance and verification

- Right-click an unselected Story in each Board view: the correct Story is selected and its menu opens once, without opening its detail screen or moving it.
- Choose each action with the mouse and keyboard: the correct Story opens or is edited, with no duplicate activation.
- Dismiss with `esc` and the close control: no action runs and Board navigation resumes.
- Try right clicks on blank space and behind an existing Modal: no underlying action runs.
- Exercise right-button press/release, modifiers, chunked input and interleaved ordinary keys through the existing input path; verify no mouse escape text leaks into keyboard input.
- Recheck left-click selection/opening, Story drag and drop, hover and sidebar resizing, including a right click during a pending drag.
- Check a small terminal and both themes. Capture actual TUI evidence using the Rowbly screenshots skill and agentic-tui, outside the repository.
- Run `pnpm typecheck`, `pnpm lint`, `pnpm test:unit` and `pnpm test:cli`. Follow ADR-0027: verify this interaction manually rather than adding screen snapshots or per-input test matrices; add a regression test only if implementation fixes a qualifying race or data-loss failure.