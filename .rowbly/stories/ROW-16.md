---
title: "Threads View: Open in sidebar instead of modal"
stage: IN_REFINEMENT
position: 1
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-16
pull_request: null
---

## Goal

In the Stories view, a Story opens in a sidebar on the right of the list (the Story sidebar), not in a Modal. In the Threads view (the Factory view), a Thread still opens in the Thread Modal. Change the Threads view so that a Thread opens in the same sidebar on the right of the list, not in a Modal. The user can then see the Thread list and the Thread at the same time, as with the Story list and a Story.

## Scope

In scope:

- `enter` or a click on a Thread row of the Factory view opens the Thread in the right sidebar.
- The Thread sidebar uses the same frame as the Story sidebar: `Panel` with the title in the top border, the `✕` (`CloseButton`), `PaneBody`, the left `ResizeEdge`, and the sizes and the `beside`/`full` modes of `shellFrame`.
- The Thread sidebar shows the same content as the Thread Modal: `ThreadDetail` (full or compact) and the live `ConversationView`.
- The `t` action of a factory warning (`openThread` in `OverlayHandlers`, from the Factory Modal) opens the Thread in the same sidebar.
- Focus and keys work as for the Story sidebar: `tab` moves the focus to the sidebar, `esc` in the sidebar gives the focus back to the list, `esc` in the list and the `✕` close the sidebar.
- Remove the `thread` overlay and the `ThreadModal` component, or keep them only if a different caller still needs them.
- Update the tests and the docs (`docs/architecture/tui.md`, the `rowbly-tui-design` skill if it names the Thread Modal).

Not in scope:

- The Threads tab inside the Story form (`threads-tab`, `thread-panel`). It does not change.
- New Thread actions (for example stop or retry). The Thread sidebar stays read-only.
- Changes to the Story sidebar behaviour for Stories.

## Acceptance criteria

- [ ] In the Factory view, `enter` on a Thread row shows a sidebar on the right of the Thread list with the title `<story-id> › <thread name>`, `ThreadDetail` and the conversation. No Modal opens. A `renderTui` test examines this.
- [ ] A click on a Thread row has the same result as `enter`. A test examines this.
- [ ] The Thread sidebar is rendered by the same sidebar frame as the Story sidebar (`Panel` + `CloseButton` + `PaneBody` + `ResizeEdge`, sized by `shellFrame`). A code review examines this.
- [ ] A drag of the left edge of the Thread sidebar changes its width, as for the Story sidebar. A test examines this.
- [ ] In a narrow terminal, the Thread sidebar takes the full main area, as the Story sidebar does. A `shell-frame` test examines this.
- [ ] The `✕` and `esc` (when the list has the focus) close the Thread sidebar. `esc` in the Thread sidebar gives the focus to the list and keeps the sidebar open. `tab` moves the focus between the Stage sidebar, the list and the Thread sidebar. Tests examine this.
- [ ] The conversation in the Thread sidebar follows new entries while the Thread runs (the behaviour of the Thread Modal is kept). The existing `thread-modal` tests move to the new component and pass.
- [ ] The footer shows the keys of the Thread sidebar (the conversation keys and `esc`) when it has the focus. A test examines this.
- [ ] `t` on a factory warning closes the Factory Modal and opens the Thread in the sidebar. A test examines this.
- [ ] When the Story sidebar has unsaved changes and the user opens a Thread, Rowbly asks before it discards the changes (the existing `discardStory` confirmation). A test examines this.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- The Story sidebar: `src/tui/shell/story-sidebar/story-sidebar.tsx` (frame) and `src/tui/shell/story-sidebar-form/` (content). Its state is `storyPane: StoryPane | null` in `src/tui/shell/shell/use-shell-state.ts`; the actions are in `src/tui/shell/shell/story-pane.ts` (`requestStoryPane`, `showStoryPane`).
- `StoryPane` is in `src/tui/shell/overlay.ts`. A small solution: add `{ kind: "thread"; thread: ThreadRecord }` to the pane type (rename it, for example to `SidePane`, if this makes the code clearer). Then the size, focus, keys and hints code of the Story sidebar (`shell-frame.ts`, `shell-keys.ts`, `shell-hints.ts`, `shell-view.ts`, `shell-props.ts`) serves the Thread too. `StorySidebar` (or a generic sidebar component that it and the Thread sidebar share) renders the Thread content in place of `StorySidebarForm` when the pane is a Thread.
- A Thread pane is never dirty. `registry.isDirty()` applies only to a Story form.
- The Thread opens now as an overlay at `shell-props.ts` (`factoryViewProps.onOpen` and `overlayHandlers.openThread`, both `env.setOverlay({ kind: "thread", thread })`). `ShellOverlays` (`src/tui/shell/shell-overlays/shell-overlays.tsx`) renders `ThreadModal`.
- The Thread content: `src/tui/screens/threads/thread-modal/` (`ThreadModal`, `useThreadModal`). Move the content into a component for the sidebar, for example `src/tui/screens/threads/thread-pane/`. Its height comes from the sidebar body (`storyBodyLayout`-like), not from `modalSize`. Its `esc` gives the focus back to the list (`onBack`), as in `StorySidebarForm`.
- Keep `useThreadChanges` and `getThread` so that the Thread reloads when the worker writes its file.
- Follow the `rowbly-tui-design` and `rowbly-code-style` skills. Use dash-case file names and `.js` import extensions. Each new component gets a test next to it.
- Update `docs/architecture/tui.md` (the sections that name the Thread Modal) in STE.

## Assumptions

- The Thread and the Story share one sidebar slot on the right; only one of them shows at a time. Reason: the author asks to use the same sidebar component, and the shell frame has room for one right sidebar.
- The sidebar stays open when the user switches between the Stories view and the Threads view. Reason: this is the current behaviour of the Story sidebar, and it is the smallest change.
- The factory warning `t` action also opens the Thread in the sidebar. Reason: it uses the same `thread` overlay, and if the overlay is removed there is one consistent way to show a Thread.
- The Threads tab inside the Story form does not change. Reason: it is not a Modal, and the author names only the Threads view.
- The Thread sidebar has no width of its own; it uses the same dragged width as the Story sidebar. Reason: smallest scope, and it is the same component.
