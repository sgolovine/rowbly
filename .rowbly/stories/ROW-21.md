---
title: Edit worker model overrides in the TUI
stage: IN_DEVELOPMENT
position: 1
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-21
pull_request: https://github.com/sgolovine/rowbly/pull/205
---

Split from ROW-20.

## Goal

ROW-20 adds worker model overrides to `.rowbly/factory.json`: an override for each Stage (`stageWorkerModels`) and an override for each Story in each Stage (`storyWorkerModels`). The factory uses the Story override, else the Stage override, else `workerModel`. With ROW-20 only, a person can see, set and clear the overrides only with `rowbly factory configure` or by editing the file.

This Story lets a person see, set and clear the overrides in the TUI:

- The Stage override, in Settings.
- The Story override for each Stage, in the Story modal.

The TUI uses the existing model picker modal (`src/tui/screens/settings/model-picker-modal/`).

## Scope

In scope:

- Settings › AI › Models tab: a list of the Stages of the Project with the Stage worker model override of each Stage. A person can select a Stage and set or clear its override.
- Story modal: a new `Models` tab with one row for each Stage. Each row shows the Story override for that Stage, or the model that applies without it. A person can select a row and set or clear the Story override for that Stage.
- A small change to `ModelPickerModal`, so that its first option has a label that agrees with the override pickers (see Technical notes).
- Tests next to each changed or new component, hook and action file.
- An update of `docs/architecture/tui.md` (in STE) for the new tab and the new list.

Not in scope:

- The storage, the services, the resolution order, the factory and the CLI flags. ROW-20 adds them.
- Overrides for the supervisor model.
- Removal of overrides when a Story or a Stage is deleted or renamed.
- An override control in Settings › Stages (the Stages section or the Stage form modal).

## Acceptance criteria

- [ ] Settings › AI › Models shows, under the `Worker model` card, one row for each Stage of the Project in board order. Each row shows the Stage label and its override as `provider/model · thinking <level>` (`modelText`), or a text such as `Worker model` when the Stage has no override. A component test examines both cases.
- [ ] In the Models tab, a person can select a Stage row (keys `↑/↓` and `enter`, and a click) when Pi has loaded. `enter` opens `ModelPickerModal` with the title `AI › Worker model › <Stage label>` and the current override selected. A test examines this.
- [ ] A save of a model in that picker writes `stageWorkerModels[<stage key>]` in `factory.json` through the ROW-20 service, shows an info toast and closes the picker. The row then shows the new model. The other keys of `factory.json` do not change. A test examines the file after the save.
- [ ] The first option of the picker for an override is labelled `No override`, not `Pi default`. To select it removes the override (`stageWorkerModels` loses the key, and an empty map is not kept). The worker and supervisor pickers still show `Pi default`. Tests examine both labels and the removal.
- [ ] The Story modal has a `Models` tab after the `Threads` tab. It has one row for each Stage of the Project in board order. Each row shows the Story override for that Stage, or the model that applies without it and its source (for example `Stage model: openai/gpt-sol` or `Worker model: Pi default`). A test examines the three sources.
- [ ] In the Story `Models` tab, `enter` (or a click) on a row opens `ModelPickerModal` with the title `<Story ID> › Model › <Stage label>`. A save writes `storyWorkerModels[<story id>][<stage key>]`. `No override` removes that entry, and removes the Story key when the Story has no other override. A test examines the file after each action.
- [ ] The Story modal does not load Pi until the person opens the `Models` tab. The tab shows a loading text until the models are available, and an error toast if Pi cannot load. A test with an injected `loadRuntime` shows that it is not called before the tab opens.
- [ ] The key hints of the new list and of the new tab show the keys that they use. `tab`, `shift+tab` and `esc` of the Story modal work as on the other tabs. A test examines the hints.
- [ ] A save error (for example a validation error from the service) shows as a toast, and the picker stays open. This is the existing behaviour of `ModelPickerModal`.
- [ ] `docs/architecture/tui.md` describes the new list and the new tab in STE.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- Dependency: start this Story after ROW-20 is merged to `main`. Use the service functions of ROW-20; do not write `factory.json` from the TUI directly. In the ROW-20 worktree, the functions are in `src/services/factory-settings/worker-overrides.ts`: `workerOverride`, `resolveWorkerModel`, `hasWorkerOverride` and `withWorkerOverride` (gives the new maps for `updateFactorySettings`). Use the names that are on `main` after the merge. If ROW-20 adds a service that sets or clears one override and validates the Stage and Story, use it. Else add a small service function next to the ROW-20 functions; the TUI must not hold this logic.
- `updateFactorySettings` merges at the top level. Write both `stageWorkerModels` and `storyWorkerModels` from `withWorkerOverride`, so that an empty map is removed.
- Model picker: `src/tui/screens/settings/model-picker-modal/model-picker-modal.tsx` and `model-picker-text.ts`. `onSave(null)` is the first option (`DEFAULT`). Add an optional prop, for example `defaultLabel` (default `Pi default`), and pass it to `modelLabels`. For an override, `null` means "remove the override".
- Settings AI section: `src/tui/screens/settings/ai-section/` (`ai-section.tsx`, `use-ai-section.ts`, `ai-actions.ts` with `saveModel`), `ai-models-page/ai-models-page.tsx`, `ai-task/ai-task.tsx` and `ai-view.ts` (`AiTask`, `Role`, `modelText`, `aiHints`). Add an `AiTask` kind such as `{ kind: "stageModel"; stage: Stage }`. Read the Stages with `listStages` (`src/services/stage/stage.ts`). The models come from `status.models`, which the AI section already loads.
- Story modal: `src/tui/screens/stories/story-modal-body/` (`storyTabIds`, `storyTabLabels`, `storyModalHints`, `use-story-modal-body.ts`), `story-tab-panes/story-tab-panes.tsx` (`StoryTabId`, `StoryTabReports`) and the `threads-tab/` folder as an example of a tab that reports its hints and its editing state. Put the new tab in a new folder, for example `src/tui/screens/stories/models-tab/`.
- Pi boundary: the board path must not load Pi. `authRuntime` and `listAvailableModels` are in `src/services/agent-auth/agent-auth.ts`. Load them in the `Models` tab only when it is shown, and take a `loadRuntime` prop (default `authRuntime`) so that tests can replace it, as `AiSection` does. Keep `src/services/pi-runtime/import-boundary.test.ts` passing.
- Read `.agents/skills/rowbly-tui-design/SKILL.md` and `.agents/skills/rowbly-code-style/SKILL.md` before the work. Use components from `src/tui/components/` (`SelectionRow`, `StageBadge`, `Loading`) and colours from `theme`.
- The supervisor loop reads `factory.json` again on each turn, so a change in the TUI applies to the next worker without a restart. The TUI does not need to tell the factory.

## Assumptions

- The Stage overrides are in Settings › AI › Models, not in Settings › Stages. Reason: the author allows both places. The AI section already loads Pi and the model list, and it already holds the worker model. The Stages section does not load Pi. This is the smallest change.
- The Story overrides are in a new `Models` tab of the Story modal, not in the General tab Form. Reason: the General tab is a Form of Story fields that saves to the Story file. The overrides save to `factory.json` and need Pi to list the models, so a separate tab keeps the Pi load and the save apart.
- Each list shows all Stages of the Project, also disabled Stages and `DONE`. Reason: the ROW-20 services accept each known Stage key, and the list then agrees with the board order and with the CLI. A filter can be a later Story.
- The first option of the override picker is labelled `No override` and removes the override. Reason: in the override pickers, the `Pi default` option would be misleading, because without an override the Stage model or the worker model applies.
- The Story `Models` tab shows the model that applies without an override and its source. Reason: the author asks that a person can "see" the overrides, and the resolution order of ROW-20 makes the inherited model not obvious.
- The Story waits for ROW-20 and does not copy its services. Reason: ROW-20 owns the storage and the services, and this Story "adds only the TUI".
## Review findings

1. GitHub cannot merge the pull request: it reports `CONFLICTING`/`DIRTY`. `main` moved to 66817e63 after the last merge into the branch (a3acbe47). The new `main` commits are scan commits (`chore(rowbly): record project changes after scan`) and #206 (cap vitest at four forks). Against the merge base `84018ecd`, these files conflict: `.rowbly/stories/ROW-18.md`, `.rowbly/stories/ROW-19.md`, `.rowbly/stories/ROW-20.md` and `.rowbly/stories/ROW-21.md` (add/add).
   - The problem: the branch has its own scan commits for these Story files, which are outside the scope of this Story. `main` changed the same files.
   - Fix: merge `origin/main` into `story/ROW-21`. For each file in `.rowbly/stories/`, keep the `main` version (`git checkout origin/main -- .rowbly/stories/`). Then the pull request does not change Story files. Run `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` again, push, and make sure that GitHub shows `MERGEABLE`.

Review notes (not blocking):

- The earlier finding (the conflict with ROW-19 in `factory-settings.test.ts` and `docs/architecture/tui.md`) is repaired in a3acbe47. The code satisfies all other acceptance criteria.
- On a3acbe47 on the review machine, `pnpm lint`, `pnpm typecheck` and `pnpm build` passed. A full `vitest run` passed (1814 tests), and the `node --test scripts` suite passed. One run had a timing failure in `use-async.test.tsx`, which passed when it ran again.
- CI `Test` failed two times, on different timing-sensitive `shell.test.tsx` tests. Similar `shell.test.tsx` tests fail on some CI runs of `main` too, so this is flaky and not a finding. The tests pass on the review machine.
- A person did not verify the layout in a real terminal.
