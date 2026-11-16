---
title: "Threads View: Add deep-link to story thread tab."
stage: IN_REVIEW
position: 1
createdAt: 2026-11-16T16:30:22.455Z
updatedAt: 2026-11-16T16:38:11.494Z
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-70
pull_request: https://github.com/sgolovine/rowbly/pull/256
---

## Goal

When a person opens a worker Thread from the Factory view (the `threads` view mode), the Thread shows in the Story sidebar (`ThreadPane`). At the moment, the person cannot go from that Thread back to the Story that the Thread works on. Add a control in the Thread pane that switches the right Panel to the Story list (`stories` mode) and opens the Story of the Thread in the Story sidebar.

Original request of the author:

- Take any running Thread. That Thread must have a link to the Story it originated from.
- In the Thread view, if I open a Thread, I cannot get back to the Story from which it originates.
- In the Thread view, add a Button. The Button must switch back to the Story view and open the Story that the Thread is linked to.

## Scope

In scope:

- An `Open Story` Button in `ThreadPane` (the Thread in the Story sidebar of the Factory view), with the key `o`.
- A shell action that sets the view mode to `stories`, shows the Story in the list (`reveal`) and opens its edit form in the Story sidebar, in place of the Thread.
- The footer hint for `o` and the update of `docs/architecture/tui.md` (section "The Factory view").

Not in scope:

- A link from the Threads tab of a Story (it is already in the Story).
- Opening a specific tab (for example the Threads tab) or selecting the Thread in the Story. The Story opens on its default tab (General).
- A link in the CLI (`rowbly thread ...`) output.
- Changes to the Thread services or the Thread file format.

## Acceptance criteria

- [ ] In the `threads` view mode, a Thread that is open in the Story sidebar shows an `Open Story` Button with the key hint `o`, when its `storyId` is a Story of the board. (Person check in a real terminal.)
- [ ] A click on the Button, or `o` while the Thread pane has the focus, sets the view mode to `stories`, selects the Story row in the Story list (it clears a Stage filter that hides the Story and expands its Stage section) and shows the edit form of the Story in the Story sidebar with the focus. (Person check.)
- [ ] When the Thread has no `storyId`, or the Story is not in the board (for example, it was deleted), the Button does not show and `o` does nothing. (Person check.)
- [ ] The footer of the Thread pane lists `o` with the description `open Story`. (Person check.)
- [ ] The conversation keys of the Thread pane (`↑/↓`, `f`, `pgup/pgdn`, `home/end`), `tab` and `esc` work as before. (Person check.)
- [ ] `docs/architecture/tui.md` describes the Button and the key `o` in "The Factory view", in STE.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- `ThreadRecord.storyId` (`src/services/thread/thread-types.ts`) gives the Story. Only worker Threads with a `storyId` show in the Factory view (`groupThreads`).
- `ThreadPane` and `useThreadPane` are in `src/tui/screens/threads/thread-pane/`. Add a prop such as `onOpenStory?(): void` (undefined when no Story is available) and a `clickable` prop for the Button. Handle `o` in the existing `useInput` of `useThreadPane` (only when `active`). Add `{ key: "o", description: "open Story" }` to `threadPaneHints` when the callback is set.
- Use the `Button` component (`src/tui/components/button/`) with `compact` and `keyName="o"`. Put it in the pane, for example on a row above or beside `ThreadDetail`. Subtract its row from the conversation height in `conversationHeight`. Use only `theme` colours. Read the `rowbly-tui-design` skill.
- `StorySidebarForm` (`src/tui/shell/story-sidebar-form/story-sidebar-form.tsx`) renders `ThreadPane`. It has `board.stories`, so it can find the Story by `pane.thread.storyId` and pass the callback. Add an `onOpenStory(story: Story)` handler through `StorySidebarProps` / `StorySidebarFormProps` and `storySidebarProps` in `src/tui/shell/shell/shell-props.ts`.
- Shell action: add a function in `src/tui/shell/shell/shell-selection.ts`, similar to `openFoundStory`: `env.setMode("stories")`, `reveal(env, story)`, then `editStory(env, story)`. A Thread is never dirty, so `requestStoryPane` does not ask.
- `docs/architecture/tui.md` "The Factory view" lists the Thread keys. Add the Button and `o` there. The help Modal (`GLOBAL_KEYS` in `src/tui/keymap.ts`) lists global keys only; `o` is a pane key, so do not add it there.
- Do not write tests in `src/tui/` (see `docs/architecture/testing.md`). No service changes are necessary.
- Use the `rowbly-screenshots` skill to check the result in a real terminal if possible.

## Assumptions

- The Story opens on its default tab (General), not on the Threads tab. Reason: the description says "open the story"; this is the smallest scope and uses the existing `editStory` path.
- The key is `o`. Reason: the warning detail of the Factory controls already uses `o` for "open the Story", and `o` is free in the Thread pane.
- The control is in the Thread pane of the Story sidebar, not on the rows of the Factory view list. Reason: the author asks for a Button "on the thread view" when a Thread is open.
- The Button does not show when the Story is not in the board. Reason: there is nothing to open, and a hidden control is simpler than an error toast.
- The view mode changes to `stories`. Reason: the author asks to "switch back to story view".
