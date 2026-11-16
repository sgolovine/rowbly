---
title: Threads Improvements - better scrolling
stage: IN_REVIEW
position: 1
createdAt: 2026-11-16T16:59:12.508Z
updatedAt: 2026-11-16T19:35:54.079Z
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-74
pull_request: https://github.com/sgolovine/rowbly/pull/262
---

## Goal

In the Factory view (the Threads mode of the main Panel), a Thread opens in the Story sidebar (`ThreadPane`). Its conversation scrolls with the mouse wheel only when the Story sidebar has the focus. The user must first click the sidebar, and then scroll.

The Story list does not have this problem: a wheel notch over the Story list moves the cursor and gives the focus to the Story list (`pointRow` in `src/tui/shell/shell/shell-selection.ts`).

Make the Thread conversation in the Story sidebar work in the same way: a wheel notch over the conversation scrolls it and gives the focus to the Story sidebar, also when a different pane had the focus.

Original request from the author:

> Update scrolling on a thread so it scrolls like the main story list does.
> - Right now on the thread view, I have to have the thread panel focused in order to scroll.
> - On the story list, the panel automatically focused when I start scrolling.
> - Make the threads view have the same behavior as the story view.

## Scope

In scope:

- The conversation of a Thread in the Story sidebar of the Factory view (`ThreadPane` in `src/tui/screens/threads/thread-pane/`).
- An optional wheel behaviour in `ConversationView` (`src/tui/components/conversation-view/conversation-view.tsx`) that `ThreadPane` uses.
- The update of `docs/architecture/tui.md` (Factory view section) and, if the props of `ConversationView` change, the component table in `.agents/skills/rowbly-tui-design/SKILL.md`.

Not in scope:

- The Thread list of the Factory view (`FactoryView`). Its wheel already scrolls without the focus, and `docs/architecture/tui.md` says that the focus does not move. Keep this behaviour.
- The Threads tab of the Story edit form (`ThreadPanel` in `src/tui/screens/stories/thread-panel/`) and the supervisor conversation in the Factory controls (`FactorySupervisor`). Their behaviour does not change.
- Keyboard scrolling. `↑/↓`, `pgup/pgdn`, `home/end` and `f` stay active only while the Thread has the focus.

## Acceptance criteria

- [ ] In the Factory view, with a Thread open in the Story sidebar and the focus on the Thread list, a wheel notch over the conversation scrolls the conversation by `WHEEL_LINES` rows and moves the focus to the Story sidebar (the sidebar border shows the focus colour, and the footer shows the Thread keys). A person examines this in a real terminal (see the `rowbly-screenshots` skill).
- [ ] With the focus already on the Thread, the wheel scrolls the conversation as before. A scroll up stops the follow of a live Thread, as before.
- [ ] While an overlay or a confirmation covers the Story sidebar (the sidebar is not `clickable`), a wheel notch over the conversation does not scroll it and does not move the focus. A person examines this.
- [ ] A wheel notch over the Thread list still scrolls the list and does not move the focus (unchanged behaviour).
- [ ] The Threads tab of the Story edit form and the supervisor conversation behave as before. A person examines this.
- [ ] `docs/architecture/tui.md` tells the new wheel behaviour of the Thread conversation, in STE.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- Today `ConversationView` calls `useMouse(ref, { onWheel: ... }, keys)` with `keys = useIsActive() && active`. In the Story sidebar, `ActiveContext` is the `focused` flag of the sidebar (`src/tui/shell/story-sidebar/story-sidebar.tsx`), so the wheel is off while the sidebar does not have the focus.
- Follow the pattern of `ScrollBody`: add optional props to `ConversationView`, for example `wheel?: boolean` (the view takes the wheel; the default is the current `keys` value) and `onWheelFocus?: () => void` (called on a wheel notch while the view does not have the keys). Keep the keys (`useInput`) on `keys` only.
- `ThreadPane` gives `wheel={props.clickable}` and an `onFocus` handler to `ConversationView`. `props.clickable` is already `clickable && !layers.covered` of the sidebar, so overlays turn the wheel off.
- Add `onFocus` to `ThreadPaneProps` (`use-thread-pane.ts`) and to `StorySidebarFormProps` (`src/tui/shell/story-sidebar-form/story-sidebar-form.tsx`). `StorySidebar` already has `onFocus` (`() => env.setPane("story")` in `src/tui/shell/shell/shell-props.ts`); pass it down to `StorySidebarForm`.
- The mouse registry sends a wheel notch to the smallest box with `onWheel` (`src/tui/hooks/mouse.ts`). The Thread `PaneBody` does not use a `ScrollBody` (`scroll={pane.kind === "new"}`), so no other box takes the wheel over the conversation.
- Do not write TUI tests (AGENTS.md rule 4). Read the `rowbly-tui-design` and `rowbly-code-style` skills before the change.

## Assumptions

- "Thread view" and "thread panel" mean the Thread conversation in the Story sidebar of the Factory view. Reason: it is the only Thread pane whose wheel needs the focus while the Story list wheel does not; the Factory view Thread list already scrolls without the focus.
- The wheel over the conversation moves the focus to the Story sidebar, as the Story list wheel moves the focus to the Story list. Reason: the author asks for the same behaviour as the Story list.
- The Thread list wheel keeps its current behaviour (it does not move the focus). Reason: `docs/architecture/tui.md` records it as an intended behaviour, and the author does not mention the list.
- The Threads tab of the Story edit form and the supervisor conversation are not changed. Reason: smallest scope that satisfies the request; the author mentions only the threads view. A new Story can add the same behaviour there.
