---
title: Factory View
stage: IN_DEVELOPMENT
position: 1
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-13
pull_request: null
---

## Goal

The user can see the work of the factory in one place. Today, the user must open each Story and its Threads tab to see its Threads. A "Factory view" in the TUI shows all worker Threads of all Stories, grouped by state. A click on a Thread opens a Modal that shows what the Thread does.

Original request from the author:

- The factory button in the header should become a switch.
- When toggled, changes between stories and threads.
- Shows all threads for all stories.
- Left sidebar still shows stages.
- On the right show two accordions: Active Threads and Inactive Threads. Add more accordions if we have more states that need to be shown.
- Show threads in each state accordingly.
- Clicking on the thread will show a modal that shows what it's doing.

## Scope

In scope:

- A view mode of the shell: `stories` (the current Story list, the default) or `threads` (the new Factory view).
- A Switch in the header Factory group that changes the view mode, and the key `t` that does the same.
- The Factory view in the right Panel: collapsible sections "Active Threads" and "Inactive Threads", with the worker Threads of all Stories.
- The Stage sidebar stays. It filters the Threads by the Stage of the Thread (`thread.stage`). "All Stages" shows all Threads.
- A Thread Modal that opens on `enter` or a click on a Thread row. It shows the Thread metadata and its live conversation.
- Live refresh of the Threads when the factory writes Thread files.
- Tests and documentation for the new code.

Not in scope:

- Supervisor Threads. The Factory controls Modal already shows the supervisor and its history.
- Actions on a Thread (cancel, resume, retry) from the Factory view or the Thread Modal.
- Story actions (move, delete, new Stage, reorder) in the Factory view.
- Persistence of the view mode between runs of Rowbly.
- Changes to the CLI.

## Acceptance criteria

- [ ] The header Factory group has a Switch with the labels `Stories` (off) and `Threads` (on). A click on the Switch changes the view mode. A click on the `Factory` label still opens the Factory controls. A header test examines the Switch and its click.
- [ ] The key `t` changes the view mode while the shell is idle (no overlay, no text input). `f` still opens the Factory controls. `GLOBAL_KEYS` and the help overlay list `t`. A shell test examines the key.
- [ ] In `threads` mode, the right Panel has the title `Threads` and shows the section "Active Threads" (status `pending` or `running`) and the section "Inactive Threads" (status `completed`, `failed`, `cancelled` or `interrupted`). Each heading shows `▾`/`▸`, the name and the count. A test examines the grouping with Threads of each status.
- [ ] Each section heading expands or collapses on `enter`, a click, or `←/→`, as the Stage sections of the Story list do. A test examines this.
- [ ] Each Thread row shows the Story id, the status glyph and status, the Stage and attempt, the model and the run time. The Threads in a section are newest first. A component test examines the row.
- [ ] Only worker Threads with a `storyId` show. Supervisor Threads do not show. A service test examines this.
- [ ] The Stage sidebar shows in `threads` mode. When a Stage is selected, only Threads with that `stage` show. With "All Stages", all Threads show. A test examines the filter.
- [ ] With no Threads, the view shows one faint line that tells the user that the factory adds a Thread when it starts a worker. A test examines this.
- [ ] `↑/↓` and `j/k` move the selection over the headings and the Thread rows. `enter` or a click on a Thread row opens the Thread Modal. A test examines this.
- [ ] The Thread Modal has the title `<story-id> › <thread name>`. It shows `ThreadDetail` and the `ConversationView` of the Thread, live while the Thread is `running`. `esc` or `✕` closes it and the selection stays on the same row. A test examines this with a test Project.
- [ ] The view refreshes when a Thread file changes (through `useThreadChanges`). A test examines this.
- [ ] The Story list, its keys and its behaviour do not change in `stories` mode. The current tests pass.
- [ ] The board, help, doctor and status paths do not load Pi (the lazy-boundary tests pass).
- [ ] `docs/architecture/tui.md` describes the Factory view, the Switch, the key `t` and the Thread Modal, in STE.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- Read `AGENTS.md`, the `rowbly-code-style` skill, the `rowbly-tui-design` skill, `docs/architecture/tui.md` and `docs/architecture/native-factory/threads-and-history.md` first.
- Services: `listThreads({ role: "worker" }, ctx)` in `src/services/thread/thread-list.ts` reads all Threads. Add a pure function in `src/services/thread/` (for example `thread-groups.ts`, exported from `thread.ts`) that filters by Stage, keeps only worker Threads with a `storyId`, and groups them into `active` (`pending`, `running`) and `inactive` (the other statuses, see `isTerminal` in `thread-types.ts`), newest first. Add a test next to it. Do not put this logic in a component.
- Header: `src/tui/shell/header/header.tsx`, `header-fit.ts` and `src/tui/shell/factory-button/factory-button.tsx`. Use the existing `Switch` component (`src/tui/components/switch/`) with `onLabel="Threads"` and `offLabel="Stories"`. Update `headerFit` so that the Switch counts in the width. When the header is narrow, the Switch can go before the Factory Button goes. The key `t` still works.
- Shell state: `src/tui/shell/shell/` (`use-shell.ts`, `shell-state.ts`, `shell-view.ts`, `shell-keys.ts`, `shell-props.ts`, `shell-hints.ts`). Add the view mode to the state. In `threads` mode, the Story keys (`n` for a new Story, `d`, `shift+↑/↓`, `ctrl+shift+↑/↓`) do nothing in the right Panel. The sidebar keys stay.
- Right Panel: `src/tui/shell/story-panel/story-panel.tsx` selects the body. Add a new body kind for the Factory view, or a sibling Panel component in `src/tui/shell/`.
- New screen components go in a new folder `src/tui/screens/threads/` (dash-case), each with a test: the Factory view list, the section heading, and the Thread Modal. Reuse `StageHeadingRow` as a model for the heading (or make a shared heading component), `ThreadRow` and `thread-text.ts` from `src/tui/screens/stories/`, `ThreadDetail`, `ConversationView`, `Modal` and `SelectionRow`. Add the Story id to the Thread row, either by a prop on `ThreadRow` or by a new row component.
- Open the Thread Modal as a new overlay kind in `src/tui/shell/overlay.ts` and `src/tui/shell/shell-overlays/shell-overlays.tsx`.
- Data: load the Threads with `useAsync` and refresh with `useThreadChanges(root, refresh)` from `src/tui/hooks/`. Use a timer for the run time of running Threads, as the Threads tab does (`use-threads-tab.ts`).
- Use only the colours in `theme`. Use `.js` extensions in relative imports.
- `ConversationView` reads Pi session files. Make sure that it does not load the Pi SDK on the board path; the existing Threads tab already uses it, so follow the same import path.

## Assumptions

- The Factory Button keeps its click and `f` (open the Factory controls), and a Switch is added beside its label in the same header group. Reason: the author asks that the button "become a switch", but the Factory controls must stay reachable by the mouse. This is the smallest change that gives the switch and keeps the current function.
- The key `t` (for "threads") changes the view mode. Reason: the switch needs a key, as each header control has one; `t` is not used by the shell.
- "Active Threads" holds `pending` and `running`; "Inactive Threads" holds `completed`, `failed`, `cancelled` and `interrupted`. No more sections are added. Reason: `isTerminal` in `thread-types.ts` already splits the statuses this way, and the row shows the exact status. This is the smallest scope that agrees with the request.
- Only worker Threads of Stories show. Reason: the author asks for "all threads for all stories"; supervisor Threads have no Story and already show in the Factory controls.
- The Stage sidebar filters the Threads by `thread.stage`. Reason: the author asks that the sidebar "still shows stages"; a filter by Stage is the same function that it has for Stories.
- The Thread Modal is read-only and shows `ThreadDetail` and the live conversation. Reason: "shows what it's doing" asks for a view, not for actions. The Threads tab of a Story already shows the same data.
- The view mode is not saved between runs. Reason: smallest scope; nothing in the request asks for it.
- The view mode Switch is the first header part that goes when the header is narrow. It shows only when the full header fits with it (about 114 columns with a short Project name). Reason: the Story says that the Switch can go before the Factory Button goes, and the current header tests at 100 columns must pass without a change. The key `t` works at each width.
- In the `stories` mode, the footer hints do not change and do not show `t`. `GLOBAL_KEYS` and the help Modal list `t`. In the `threads` mode, the footer shows `t Stories`. Reason: the Story list must not change in the `stories` mode, and its hint tests must pass.
- A click on a Thread row selects the row and opens the Thread Modal at once. Reason: the acceptance criteria say that a click on a Thread row opens the Modal.
- The Thread rows reuse `ThreadRow` with a new `storyId` prop. Reason: the row already shows the status, the Stage and attempt, the model and the run time.
