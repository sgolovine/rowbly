---
title: Scroll does not work when a sidebar is open
stage: DONE
position: 22
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-22
pull_request: https://github.com/sgolovine/rowbly/pull/209
---

## Goal

When the Story sidebar is open, the mouse wheel does not scroll the Thread list in the main Panel. The user must be able to scroll the main Panel with the wheel while the sidebar is open, in the Threads view and in the Stories view. The attached screenshot shows the problem: a Thread is open in the sidebar, and the wheel does nothing over the Thread list (264 rows).

## Scope

In scope:

- The mouse wheel over the main Panel scrolls it while the Story sidebar is open, also when the sidebar has the keyboard focus.
  - Threads view: the Thread list of `FactoryView`.
  - Stories view: the Story list of `StoryList`.
- Tests for the two views.

Not in scope:

- A change to the keyboard focus. `↑/↓`, `j/k`, `pgup/pgdn` continue to go only to the pane that has the focus.
- The wheel over the content of the sidebar (the Threads tab, the Thread conversation, the General tab) when the main list has the focus.
- Other scroll areas (Settings, Modals, onboarding).

## Acceptance criteria

- [ ] Threads view: with more Thread rows than the Panel can show, and a Thread open in the sidebar with the focus on the sidebar, a `wheelDown` over the Thread list changes the visible rows (the `↑↓ <start>–<end> of <n>` line of `ScrollBody` changes). A `wheelUp` scrolls back. A test examines this.
- [ ] Threads view: when the sidebar is closed, the wheel over the Thread list continues to scroll it. A test examines this.
- [ ] Stories view: with more Story rows than the Panel can show, and a Story open in the sidebar with the focus on the sidebar, a `wheelDown` over the Story list moves the visible rows. A shell-level test examines this. If the test passes without a code change, keep the test as a regression test.
- [ ] While a Modal or an overlay covers the shell (`idle` is false), the wheel does not scroll the main list.
- [ ] While the sidebar has the focus, `pgup/pgdn` do not scroll the main Thread list.
- [ ] Existing users of `ScrollBody` keep their current behaviour.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- Cause (Threads view): `src/tui/screens/threads/factory-view/factory-view.tsx` renders `<ScrollBody active={active}>`. `active` is `listFocused` (`src/tui/shell/shell/shell-props.ts`, `factoryViewProps`), and `listFocused` is false when the sidebar has the focus (`src/tui/shell/shell/shell-view.ts`). `ScrollBody` (`src/tui/components/scroll-body/scroll-body.tsx`) uses the same `active` value for `pgup/pgdn` (`useInput`) and for the wheel (`useMouse`). Thus the wheel stops when the list loses the keyboard focus.
- Suggested fix: add an optional `wheel?: boolean` prop to `ScrollBody`. The wheel is on when `useIsActive() && (wheel ?? active) && max > 0`. The keys continue to use `active`. The default `wheel ?? active` keeps the behaviour of all other users.
- In `FactoryView`, pass `wheel={clickable}`. `clickable` is `idle` from `factoryViewProps`. It is false while an overlay is open.
- Stories view: `StoryList` (`src/tui/screens/stories/story-list/story-list.tsx`) turns on the wheel with `clickable && view.overflow`, where `clickable` is `idle`. The wheel calls `onCursor` → `pointRow` (`src/tui/shell/shell/shell-selection.ts`), which moves the focus to the list and moves the cursor. Make sure with a shell test (`src/tui/shell/shell/shell.test.tsx`) that this works with the sidebar open. If it fails, repair it with the same principle: the wheel follows `idle`, not the keyboard focus.
- Tests: `src/tui/components/scroll-body/scroll-body.test.tsx` (the new `wheel` prop: wheel on with `active={false}`), `src/tui/screens/threads/factory-view/factory-view.test.tsx` (wheel with `active={false}` and `clickable`), and the shell test for the two views. Use `renderTui` and `tui.mouse("wheelDown", x, y)`. See `docs/architecture/testing.md`.
- Read `.agents/skills/rowbly-code-style/SKILL.md` and `.agents/skills/rowbly-tui-design/SKILL.md` before the change. If `docs/architecture/tui.md` describes the wheel and the focus, update it in STE.

## Assumptions

- "Scrolling" means the mouse wheel over the main Panel. Reason: the screenshot marks the Thread list while the sidebar has the focus, and the keyboard keys go to the focused pane by design.
- The fix does not change the keyboard focus when the wheel scrolls the Thread list. Reason: the smallest change; the user can continue to read the Thread in the sidebar with the keys.
- The wheel over the sidebar content while the list has the focus is not in scope. Reason: the Story reports the main list only. A person can add a new Story for it.
