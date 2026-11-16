---
title: Threads Improvements - full-screen view.
stage: IN_DEVELOPMENT
position: 2
createdAt: 2026-11-16T17:00:18.867Z
updatedAt: 2026-11-16T19:43:52.615Z
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-75
pull_request: https://github.com/sgolovine/rowbly/pull/264
---

## Goal

When a user reads the message history of a Thread, the view is small: it shares the Story sidebar or the Threads tab with the Thread detail and other panes. The user wants to press `ctrl+f` to show the message history over the full terminal, and press `ctrl+f` again to go back. This must operate the same as `ctrl+f` on a text area, which opens a `FullScreenEditor` over the whole terminal.

## Scope

In scope:

- A read-only full-screen view of the conversation of one Thread. `ctrl+f` opens it and `ctrl+f` or `esc` closes it.
- The two places where a user views a worker Thread:
  - `ThreadPane` (`src/tui/screens/threads/thread-pane/`), the Thread in the Story sidebar of the Factory view (`t`).
  - `ThreadPanel` (`src/tui/screens/stories/thread-panel/`), the Thread region of the Threads tab of a Story.
- The footer hints and the help overlay (`GLOBAL_KEYS` in `src/tui/keymap.ts`) show the new key.
- The documentation in `docs/architecture/tui.md` (STE).

Not in scope:

- The supervisor conversation in the factory Modal (`FactorySupervisor`). It already fills the body of a Modal.
- A change to the scroll behaviour of `ConversationView` (ROW-74 has this work).
- Steering a Thread (ROW-76).
- A full-screen view of the Thread metadata (`ThreadDetail`) or the checks.

## Acceptance criteria

- [ ] In the Factory view, when the Thread pane has the focus, `ctrl+f` opens the conversation of the Thread over the whole terminal (the same area that a `FullScreenEditor` covers). A person examines this in a real terminal.
- [ ] In the Threads tab of a Story, when the Thread region has the focus and the conversation shows, `ctrl+f` opens the same full-screen view. A person examines this.
- [ ] The full-screen view has a border title `<story-id> › <thread name>` (the same text as the Thread panel title) and a footer with the conversation keys (`conversationKeys(live)`) and `ctrl+f`/`esc` close.
- [ ] In the full-screen view, `↑/↓`, `j/k`, `pgup/pgdn`, `home/end`, the mouse wheel and `f` (follow, while the Thread runs) operate as in the small view.
- [ ] While the Thread runs, the full-screen view follows the new entries, as the small view does.
- [ ] `ctrl+f`, `esc` or a click on the `✕` of the border closes the full-screen view. The Thread pane or the Thread region then has the focus again, and the Thread stays open. `esc` in the full-screen view does not also close the Thread or move the focus to the Thread list.
- [ ] While the full-screen view is open, the panes below it take no keys and no wheel events.
- [ ] The footer of `ThreadPane` and of the Threads tab, while the Thread has the focus, show `ctrl+f` with the description `full screen`.
- [ ] The help overlay lists `ctrl+f` for the Thread conversation (update the `ctrl+f` entry of `GLOBAL_KEYS` or add an entry).
- [ ] `docs/architecture/tui.md` describes the key in STE.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- `ConversationView` (`src/tui/components/conversation-view/conversation-view.tsx`) already takes `width`, `height` and `active`, and ignores `ctrl` keys in `handleConversationKey`. A second instance with the size of the full-screen body can show the conversation. It opens the conversation file again; this is acceptable because it reads only pages of 20 entries.
- Follow the pattern of `useFullScreenEditor` (`src/tui/components/use-full-screen-editor.tsx`): open the node with `useMainOverlay()` so that it covers the screens and the shell, and render it `inline` when no overlay host exists. Use `Modal` with `size="screen"` and `maxWidth={outer.width}`, and `modalSize(outer, { size: "screen", maxWidth: outer.width, footer: true }).body` for the size of the `ConversationView`. `FactorySupervisor` shows the same sizing for a Modal body.
- Put the new reusable part in `src/tui/components/` (for example `full-screen-conversation/` and `use-full-screen-conversation.tsx`), with dash-case names and `.js` import extensions. Export it from `src/tui/components/index.ts`.
- While the full-screen view is open, give `active={false}` to the small `ConversationView` and stop the pane keys (`useThreadPane`, `useEscape`) so that `esc` closes only the full-screen view. The `isOpen` value of the control, as in `FullScreenEditorControl`, can do this.
- `ThreadPane` handles its keys in `paneKey` in `use-thread-pane.ts`. The Threads tab handles its keys in `src/tui/screens/stories/threads-tab/` (`threads-tab-actions.ts`, `use-threads-tab.ts`). Add `ctrl+f` there only when the Thread region has the focus (`viewing`) and the conversation shows (`shownId === current.id`).
- The shell `ctrlKey` in `src/tui/shell/shell/shell-keys.ts` does not use `ctrl+f`, so there is no conflict.
- Read the `rowbly-tui-design` and `rowbly-code-style` skills first. Use only `theme` colours. Do not write TUI tests (AGENTS.md). No service changes are necessary.
- ROW-74 (better scrolling, in development) can change `conversation-keys.ts` and `conversation-view.tsx`. Rebase on it if it merges first.

## Assumptions

- The feature applies to the worker Thread views (`ThreadPane` and the Threads tab), not to the supervisor conversation in the factory Modal. Reason: the author writes "viewing a thread", and the supervisor view already fills a Modal. This is the smallest scope.
- The full-screen view shows only the conversation, not the Thread metadata. Reason: the author asks for "a full-screen view of the message history".
- `esc` also closes the full-screen view, and the `✕` in the border closes it. Reason: `FullScreenEditor` closes with `esc`, `ctrl+f` and the `✕`, and the author asks for the same behaviour.
- The full-screen view starts at the newest entries (and follows while the Thread runs). It does not keep the scroll position of the small view. Reason: a new `ConversationView` starts at the end; to share the position needs a change to the window state, which is a larger scope.

## Review findings

- CHANGELOG Stage: the merge of `origin/main` into `story/ROW-75` has a conflict in `src/tui/screens/threads/thread-pane/thread-pane.tsx`. Merge `origin/main` (it has the ROW-74 changes) into the branch, repair the conflict, and run `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build`. The merge was aborted. The branch did not change.
