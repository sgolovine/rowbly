---
title: Click and dismiss warnings
stage: IN_REFINEMENT
position: 1
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-14
pull_request: null
---

## Goal

The Factory controls (`f`) show an `Attention` list of factory warnings. Each row is cut to one line, the list
shows a maximum of five rows, and a person cannot select a row. A person cannot read a long warning, cannot
find the Story or the Thread that caused it, and cannot remove a warning after the problem has a solution.

The original request of the author:

- I should be able to click into a factory warning to read it.
- I should be able to correlate a factory warning with a story/thread to do deeper investigation.
- Should be able to dismiss warnings.

Result: in the TUI, a person can open each factory warning and read its full text. From the warning, the person
can open the related Story or Thread. The person can dismiss a warning that the factory recorded, and the
warning stays dismissed after a restart of the factory, until the factory records it again.

## Scope

In scope:

- A selectable view of all the factory warnings (the rows of `factoryProblems`) in the Factory Modal.
- A detail view of one warning: the full wrapped text, its kind, and the related Story and Thread.
- Open the related Story (Story sidebar) or the related Thread (Thread Modal) from the detail view.
- Dismiss of one attention entry of the live factory. The daemon removes the entry from its state and from
  `.rowbly/runtime/status.json`.
- A new daemon control command type for the dismiss, a service function that sends it, and tests.

Not in scope:

- Dismiss of derived warnings: the heartbeat warning, the provider pauses and the Thread file issues. They
  show a live condition and go away when the condition goes away.
- A CLI command for the dismiss. The service function is available for a later CLI command.
- A `threadId` argument for the `raise_attention` supervisor tool.
- The `FactoryStatusLine` warning below the Story list (a problem with the factory state file).
- Warnings of a stopped factory. `factoryProblems` gives no warnings when the factory does not run.

## Acceptance criteria

- [ ] In the Factory Modal, the key `w` opens the view `Factory › Attention` when the live factory has one or
      more warnings. The view lists all warnings, not only five. `↑/↓` selects a row, `enter` opens the
      detail view and `esc` goes back. The Modal hints show these keys. A component test examines this.
- [ ] A click on a row of the `Attention` list in the overview opens the detail view of that warning.
      A component test examines this.
- [ ] The detail view `Factory › Attention › <title>` shows the full text of the warning with wrap, not
      truncated. A component test with a text longer than the Modal width examines this.
- [ ] For a warning with a `storyId`, the detail view shows the Story ID and title. The key `o` (and a
      `Story` button) closes the Factory Modal and opens that Story in the Story sidebar. A test examines this.
- [ ] For a warning with a related Thread, the detail view shows the Thread ID and status. The key `t` (and a
      `Thread` button) opens that Thread in the Thread Modal. A test examines this.
- [ ] The related Thread is: for the attention key `supervisor`, the supervisor Thread of the status file
      (`supervisorThreadId`); for a warning with a `storyId`, the newest Thread of that Story. Other warnings
      have no Thread. A unit test examines this function.
- [ ] For a Thread file issue (`{ file, message }`), the detail view shows the file path and the message.
- [ ] For an attention entry, the key `d` (and a `Dismiss` button) sends a dismiss command to the daemon.
      After the receipt, the warning is not in the list, and the `! n` count of the header Factory button is
      one less. The heartbeat, provider and Thread file warnings show no `Dismiss` action. A test examines this.
- [ ] A dismiss that fails (the factory stopped, the receipt is `rejected` or the command times out) shows an
      error toast and keeps the warning. A test examines this.
- [ ] `FactoryCommand.type` accepts `"dismiss"` with a field `attentionKey` (1 to 128 characters). The daemon
      rejects a dismiss without `attentionKey`. A test in `factory-control.test.ts` or
      `control-poller.test.ts` examines this.
- [ ] The manager removes the entry with that key from `attention`, then writes the status file. A dismiss of
      a key that does not exist completes without an error. A test in `factory-manager.test.ts` examines this.
- [ ] After a dismiss and a restart of the factory, the dismissed entry does not come back from the stored
      status file. A test examines this.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

Where the warnings come from:

- `src/tui/screens/factory/factory-status.ts`: `factoryProblems(status)` builds the warnings from
  `status.attention`, `status.providers` and the heartbeat. The keys are `heartbeat`, `attention:<key>`,
  `issue:<file>` and `provider:<name>`. Extend `FactoryProblem` with a kind (`heartbeat`, `attention`,
  `issue`, `provider`), the raw attention key, the optional `storyId` and a `dismissible` flag. Keep
  `factoryButtonWidth` and the header count correct.
- `src/services/factory-manager/manager-status.ts` `buildSnapshot` writes
  `attention: [...issues, ...state.attention.entries()].slice(0, 12)`. Thread file issues come from
  `listThreads` (`src/services/thread/thread-list.ts`) and are not in the manager state.
- The manager state `attention` is a `ReadonlyMap<string, Attention>` (`manager-state.ts`). Entries come from
  `raise_attention` (`supervisor-tools.ts`), and from the keys `reconcile`, `commit`, `supervisor`
  (`supervisor-loop.ts`) and `external` (`factory-manager.ts`). Today no code removes an entry.

Dismiss path (follow the pattern of `cancel` and `resume`):

- `src/services/factory-control/factory-control.ts`: add `"dismiss"` to `FactoryCommand.type` and to the
  list in `acceptedCommand`. Add the optional field `attentionKey`. A command file stays at most 4096 bytes.
- `src/commands/factory-runner/control-poller.ts`: `executeCommand` calls a new `dismissAttention(key)` on the
  manager. Add it to `ControlTarget`.
- `src/services/factory-manager/factory-manager.ts`: expose `dismissAttention`. It runs in `serial`, uses
  `withoutEntry` from `src/services/store/store.ts`, then calls `persistStatus`.
- `src/services/factory/factory.ts`: let `sendFactoryCommand` accept `"dismiss"` and `attentionKey`, or add
  `dismissFactoryAttention(key, ctx)`. Do not load Pi on this path.

TUI:

- `src/tui/screens/factory/factory-modal/use-factory-modal.ts` has the views `main`, `supervisor` and `history`.
  Add `attention` (list) and an attention detail view. Use `FactoryHistory` and `SelectList` as the pattern for
  the list. Update `modalFrame` in `factory-modal.tsx` and `factoryHints` in `factory-modal-text.ts`.
- `src/tui/screens/factory/factory-overview/factory-overview.tsx` and `factory-list/factory-list.tsx`: make the
  rows clickable while the Modal is idle.
- To open a Story or a Thread, give `FactoryModal` the callbacks `onOpenStory(story)` and `onOpenThread(thread)`
  from `src/tui/shell/shell-overlays/shell-overlays.tsx`. Use `handlers.openStory` and the overlay
  `{ kind: "thread", thread }` (`src/tui/shell/overlay.ts`). Find the Story in `board.stories`. If the Story
  does not exist, show the ID without the action.
- Use `useToast` for the dismiss error, as `threads-tab-actions.ts` does for `sendFactoryCommand`.
- Read the `rowbly-tui-design` and `rowbly-code-style` skills. Use only `theme` colours.

Documentation: update `docs/architecture/tui.md` (Factory Modal keys) and
`docs/architecture/native-factory/` (the `dismiss` control command) in STE.

## Assumptions

- A "factory warning" is a row of the `Attention` list of the Factory Modal (`factoryProblems`), not the
  `FactoryStatusLine` below the Story list. Reason: the author says "factory warning", and the header shows
  these rows as `! n`.
- "Click into" means a mouse click and a keyboard path, with a detail view in the Factory Modal. Reason: the
  TUI design gives each mouse action a key, and the History view of the same Modal uses this pattern.
- The key `w` opens the list, and `o`, `t`, `d` are the detail actions. Reason: `enter` in the main view
  already opens the supervisor, and these keys are not used in the Factory Modal.
- The related Thread of a warning with a `storyId` is the newest Thread of that Story, and the `supervisor`
  key relates to the supervisor Thread. Reason: attention entries have no `threadId`, and this needs no change
  to the supervisor tools.
- Only attention entries of the manager can be dismissed. Reason: the heartbeat, provider pause and Thread file
  warnings are computed from the live state on each snapshot, so a dismiss would not last, and to hide them
  could hide a real problem.
- The dismiss is stored by the daemon, not only in the TUI. Reason: the attention entries are in the daemon
  state and in `status.json`; a TUI-only dismiss would come back on each new TUI and in `factory status`.
- A dismissed entry comes back if the factory records the same key again. Reason: a new occurrence is new
  information.
- No CLI command in this Story. Reason: the smallest scope that gives the result of the author, who asks for
  TUI actions. The service function makes a later CLI command small.
- The Story is not split. Reason: the control command, the manager change and the TUI views are small and
  follow existing patterns, so one pull request can hold them.
