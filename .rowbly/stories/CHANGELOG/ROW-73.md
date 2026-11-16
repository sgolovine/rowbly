---
title: Show factory connectivity state in the TUI
stage: CHANGELOG
position: 1
dependsOn:
  - ROW-71
createdAt: 2026-11-16T16:41:21.272Z
updatedAt: 2026-11-16T18:35:17.591Z
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-73
pull_request: https://github.com/sgolovine/rowbly/pull/260
---

Split from ROW-71.

## Goal

Show the connectivity state of the native factory in the TUI. ROW-71 adds the `connectivity` field (`online`, `degraded` or `offline`) to the factory status and the `network` provider pause. ROW-71 also gives a Thread that stopped because of a network failure the error class `transient` and the code `NETWORK`, and makes the factory resume these Threads automatically.

Today the user sees these facts only in the problem list of the Factory controls (`Provider <id> is paused (network) until <time>.`). With this Story the user also sees them in the header, on each Thread and in the queue reason of a Story.

## Scope

In scope:

- The header Factory Button shows `offline` or `degraded` (for example `Factory offline`) when the live status has that `connectivity`.
- The Thread rows (Threads tab of a Story and the Factory view) and the Thread detail (Threads tab and the Thread pane of the Story sidebar) show the label `waiting for network` on a Thread that waits for connectivity.
- The queue reason of a Story whose worker provider has a `network` pause says that the Story waits for the network.
- A small service change: each queue entry in `status.json` gets the provider of the worker model of its Story, so that the TUI can find the pause.
- The docs of the TUI.

Not in scope:

- The service side of ROW-71 (error classification, `network` pause, automatic resume, the `connectivity` field). This Story depends on ROW-71.
- A new screen, a new Modal or a toast for connectivity.
- TUI tests (the repository rules forbid them).

## Acceptance criteria

- [ ] `factoryState()` in `src/tui/screens/factory/factory-status.ts` returns `offline` when the status is live (`factoryLive`) with phase `ready` and `connectivity: "offline"`, and `degraded` for `connectivity: "degraded"`. These words replace the worker counts. For `online`, for no `connectivity` field and for a factory that is not live, the text does not change (`off`, `2/4 · 1 pending`, etc.). A person examines this in a real terminal (see the `rowbly-screenshots` skill) or by a read of the code.
- [ ] The Factory Button shows the state word in `theme.danger` for `offline` and in `theme.stageBoard` for `degraded`; other states keep `theme.inkMuted`. The `! n` problem count still shows. `factoryButtonWidth()` gives the correct width for the new texts, so that `header-fit.ts` stays correct. A person examines this.
- [ ] A new pure helper `threadWaitsForNetwork(thread)` in `src/tui/screens/stories/thread-text.ts` returns `true` only when `thread.status === "failed"`, `thread.error?.class === "transient"` and `thread.error?.code === "NETWORK"`.
- [ ] `ThreadRow` (`src/tui/screens/stories/thread-row/thread-row.tsx`) adds ` · waiting for network` in `theme.stageBoard` to row 1 after the Stage name when `threadWaitsForNetwork()` is true, also in `compact` mode. A person examines this.
- [ ] `ThreadDetail` (`src/tui/screens/stories/thread-detail/thread-detail.tsx`) adds ` · waiting for network` in `theme.stageBoard` to its status line (full and compact) when `threadWaitsForNetwork()` is true. The Thread pane gets the label through `ThreadDetail`. A person examines this.
- [ ] `FactoryQueueEntry` (`src/services/factory/factory.ts`) has an optional `provider?: string`. `persistStatus()` in `src/services/factory-manager/manager-status.ts` sets it from `resolveWorkerModel(state.settings, d.story, d.stage)?.provider` (`src/services/factory-settings/worker-overrides.ts`); it leaves it out when no worker model resolves. A test in `factory-manager.test.ts` confirms that a queue entry in `status.json` has the provider of the worker model.
- [ ] `queueReason(entry, providers?)` returns `waiting for the network until <formatDateTime(retryAt)>` (without `until …` when the pause has no `retryAt`) when `providers[entry.provider]` has `reason: "network"`. Else it returns the current texts. The Factory overview (`factory-overview.tsx`) and the Threads tab note (`thread-list-panel.tsx`, through `use-threads-tab.ts`) give `status.providers` to it. A person examines this.
- [ ] `docs/architecture/tui.md` (section "Factory status" or "The Factory view") describes the connectivity word of the Factory Button, the `waiting for network` label and the network queue reason, in STE.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- Read the `rowbly-tui-design` skill and the `rowbly-code-style` skill first. Use only the colours in `theme` and the components in `src/tui/components/`.
- Header: `src/tui/shell/factory-button/factory-button.tsx` (`noteParts`, `factoryButtonWidth`, `FactoryButton`) and `src/tui/shell/header/header-fit.ts`. `factoryState()` and `factoryLive()` are in `src/tui/screens/factory/factory-status.ts`. The header must keep its fit rules for a narrow terminal (`short`).
- The status type `FactoryStatus` comes from the manager snapshot (`buildSnapshot()` in `manager-status.ts`). After ROW-71 it has `connectivity` and `providers` (a record of `ProviderPause` `{ reason, retryAt?, ... }`). Read `connectivity` and `providers` as optional fields; an old `status.json` does not have them.
- Thread error type: `src/services/thread/thread-types.ts` (`error.class`, `error.code`). Thread helpers: `src/tui/screens/stories/thread-text.ts`.
- Queue: `persistStatus()` in `src/services/factory-manager/manager-status.ts` builds `queue`. `queueReason()` and `queueEntry()` are in `src/tui/screens/factory/factory-status.ts`; callers are `factory-overview.tsx` and `thread-list-panel.tsx` (`waitingNote`). Give the providers to `ThreadListPanel` as a new prop from `use-threads-tab.ts`, which already reads the status.
- The service change does not import `ink` or `react`. Keep the Pi SDK out of the TUI paths.
- Use `.js` extensions in relative imports.

## Assumptions

- Development starts only after ROW-71 is merged, and uses the field names of ROW-71 (`connectivity`, pause reason `network`, error class `transient` with code `NETWORK`). Reason: ROW-71 defines these fields, and the Story already depends on ROW-71.
- The connectivity word replaces the worker counts in the Factory Button (`Factory offline`, `Factory degraded`). Reason: the original Story gives `Factory offline` as the example, and the header has little room.
- `offline` uses `theme.danger` and `degraded` uses `theme.stageBoard`. Reason: these are the existing tokens for an error and a warning in the TUI.
- The label `waiting for network` shows only on a `failed` Thread with code `NETWORK`. A resumed Thread is `pending` or `running` and shows no label. Reason: smallest scope that agrees with the resume flow of ROW-71.
- The queue entry gets the provider of the resolved worker model (Story override, Stage override, then `workerModel`). A supervisor can select a different model at launch; then the reason can be wrong. Reason: the resolved model is the best information that the status has before a launch, and this is the smallest service change.
