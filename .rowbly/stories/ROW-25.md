---
title: Add a view for deterministic checks
stage: IN_DEVELOPMENT
position: 4
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-25
pull_request: null
---

## Goal

The native factory runs the deterministic checks of its workers (for example `pnpm test`) through one check queue. A person cannot see in one place which checks run and which checks wait for each Thread. The Factory controls show only a summary row (`2 running · 1 queued · limit 4`).

Add a **Checks** Button to the TUI header. A click or its key opens a Modal that lists all the checks in the queue of the live factory, for all Threads: the checks that run and the checks that wait.

## Scope

In scope:

- A new header Button `Checks`, in the Factory group of the header, after the Factory Button and the view mode switch, before the `|` separator.
- A new global shell key `c` that opens the same Modal.
- A new read-only Modal that lists the running and queued check jobs from `FactoryStatus.checks`.
- Tests for the new component, the Modal, the header fit and the key, and documentation updates.

Not in scope:

- Changes to the check queue, `status.json`, `CheckQueueStatus` or other services. The status already has the data.
- Cancel, retry or other actions on a check from the Modal.
- The history of finished checks (`runtime/checks/jobs.json`) and the check logs.
- Changes to the Checks tab of Settings (the check configuration).

## Acceptance criteria

- [ ] When the live factory status has `checks` (`factoryLive(status) && status.checks !== undefined`), the header shows a `Checks` Button with the note `<running>/<queued>` in `ink-muted`, for example `Checks 2/1`. A component test of `Header` examines this.
- [ ] When the factory is not live, or its status has no `checks`, the header does not show the Button. A component test examines this.
- [ ] A click on the Button opens the Checks Modal. A `renderTui` test examines this.
- [ ] The key `c` in the shell opens the Checks Modal when the Button condition is true. The key does nothing when the condition is false. The key does not open the Modal when a text field or a different overlay has the focus. A test examines this.
- [ ] The Modal shows one row for each job in `status.checks.jobs`. Running jobs come first, then the queued jobs in the order of the queue. Each row shows the Story ID, the Stage label, the check key, the scope (`full` or `narrow`), the status (`running` or `queued`), and the time since `startedAt` (running) or since `queuedAt` (queued). A component test examines this.
- [ ] The Modal shows the summary line from `checksText(status.checks)` at the top.
- [ ] When the queue has no jobs, the Modal shows an empty-state text, for example `No checks run or wait.`. A component test examines this.
- [ ] The Modal updates when the factory status changes (it reads the status that the shell already polls). A test examines that a new status gives new rows.
- [ ] `↑/↓` move the selection when the list is longer than the Modal body, and Escape or the close Button closes the Modal and gives the focus back to the previous pane. A test examines this.
- [ ] When the header is too narrow, the Checks Button goes before the view mode switch goes (the Checks Button is the first part to go). `header-fit.test.ts` examines this.
- [ ] `GLOBAL_KEYS` in `src/tui/keymap.ts` has `{ key: "c", description: "checks in the factory queue" }`, so that the help Modal lists it.
- [ ] `docs/architecture/native-factory/controls.md` and `docs/architecture/tui.md` describe the Button, the key and the Modal in STE.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- Data: `FactoryStatus.checks` (`CheckQueueStatus` in `src/services/check-queue/check-types.ts`) has `running`, `queued`, `availableMb`, `maxConcurrent` and `jobs` (`id`, `threadId`, `storyId`, `stage`, `key`, `scope`, `status`, `queuedAt`, `startedAt`, `estimateMb`). `manager-status.ts` writes it to `status.json` only when `factory.json` has a `checks` section. The jobs are only the running and queued jobs. `checkQueueStatus` in `check-queue.ts` gives them in queue order.
- The shell already reads the factory status and gives it to `Header` (`factory.status`) and to `ShellOverlays` (`factory`). Use this value. Do not add a new service read and do not load Pi.
- Header: `src/tui/shell/header/header.tsx` and `header-fit.ts` (width rules, `ROW_WIDTH_*`). Make a new `src/tui/shell/checks-button/` with `ChecksButton` and `checksButtonWidth`, in the same pattern as `src/tui/shell/factory-button/`.
- Overlay: add a `checks` kind to the `Overlay` type in `src/tui/shell/overlay.ts`, and render the Modal in `src/tui/shell/shell-overlays/shell-overlays.tsx`. Open it from the shell keys in `src/tui/shell/shell/shell-keys.ts` and from the header click in the shell.
- Modal: make a new screen component, for example `src/tui/screens/factory/checks-modal/`. Build it from `src/tui/components/` (`Modal`, `ModalBody`, `SelectList` or `ScrollBody`, `KeyHints`). Use only `theme` colours. Read the `rowbly-tui-design` and `rowbly-code-style` skills first.
- Stage labels: `ShellOverlays` has `stageLabels(board)`. Use it to show the Stage label in place of the key.
- Times: use the existing helpers of `src/tui/screens/factory/factory-modal-text.ts` or the date helpers that the Factory screens use. Put pure text helpers in a `.ts` file with a unit test.
- `factoryLive` is in `src/tui/screens/factory/factory-status.ts`.
- Related: `src/tui/screens/threads/thread-checks/` shows the finished checks of one Thread. Do not change it.
- Docs: `docs/architecture/native-factory/checks.md`, `docs/architecture/native-factory/controls.md`, `docs/architecture/tui.md`.

## Assumptions

- "Deterministic checks in the queue" means the check jobs of the native factory check queue (`run_check`), with status `running` or `queued`. Reason: `docs/architecture/native-factory/checks.md` calls these the deterministic checks of the workers, and `status.json` already has them for all Threads.
- The Modal is read-only. Reason: the Story asks for a view. Smallest scope.
- The key is `c`. Reason: `c` is not a global shell key now. It is used only inside the Settings AI section, which is a different overlay.
- The Button shows only when the live factory has checks. Reason: without a live factory or without a `checks` section, the queue does not exist, and the header has limited width.
- The Modal shows the check key, not the check label. Reason: `CheckQueueStatus.jobs` has only the key. A label lookup needs a settings read. The developer can add the label from the factory settings if the shell already has them, without a new service.
- The Modal does not show finished checks. Reason: the Story says "in the queue". `ThreadChecks` already shows the finished checks of each Thread.
