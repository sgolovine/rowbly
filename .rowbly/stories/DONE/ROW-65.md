---
title: Show and edit Story dependencies in the TUI
stage: DONE
position: 50
uid: 2f8f4471-df9f-479d-9b94-8e257a098417
createdAt: 2026-11-14T23:26:47.000Z
updatedAt: 2026-11-15T00:13:32.000Z
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-65
pull_request: https://github.com/sgolovine/rowbly/pull/238
---

## Goal

Users can see and edit the dependencies of a Story in the TUI. Now only the CLI shows and changes `dependsOn` (ROW-60), and only the factory policy uses the blocked state (ROW-62). The TUI user cannot see that a Story waits for other Stories, and cannot change the list.

## Scope

In scope:

- The General tab of a Story (`src/tui/screens/stories/story-general-tab/`) shows `Depends on` and `Blocks`. Each item shows the ID, the title and the Stage (`StageBadge`).
- The user can add an upstream Story with a picker of the Stories of the Project, and remove one upstream Story. The picker does not show the Story itself, a Story that is already in the list, or a Story that makes a cycle. A service error (`ValidationError`) shows in the form.
- The new Story form can also set `Depends on`, with the same picker.
- A blocked Story row on the board shows a small blocked mark. The mark uses only the colours of `theme`.
- A blocked Story in a work Stage shows `waiting for ROW-01, ROW-02` in its row (see Assumptions).
- Mouse and keys follow the rules of the `rowbly-tui-design` skill. Each new action has a key hint and a click target.

Not in scope:

- `Blocks` is read-only. The user changes a downstream relation from the downstream Story.
- Changes to the factory policy, the CLI or the storage format.
- Dependencies between Projects.

## Acceptance criteria

- [ ] The General tab shows `Depends on` and `Blocks`. Each item shows the ID, the title and the Stage. An empty list shows `none`.
- [ ] An addition or a removal in the General tab saves through `updateStory` (`dependsOn`, `addDependsOn` or `removeDependsOn`). `rowbly story get <id> --json` then shows the new `dependsOn` list.
- [ ] The new Story form can set `Depends on`, and `createStory` gets the list.
- [ ] The picker does not show the Story itself, the Stories already in the list, or a Story that makes a cycle. A unit test of the new pure function in `src/services/story-dependency/` examines these three rules.
- [ ] A `ValidationError` from the service shows in the form, and nothing is saved.
- [ ] A blocked Story row shows the blocked mark. When all upstream Stories go to the last Stage, the mark goes away after the board refreshes. A person examines this in a real terminal.
- [ ] A blocked Story in a work Stage with no active worker shows `waiting for <IDs>` in its row, with the IDs of `waitingFor`.
- [ ] `docs/architecture/tui.md` describes the new fields, the picker, the mark and the `waiting for` text, in STE.
- [ ] Screenshots of the General tab and the board are in the PR (see the `rowbly-screenshots` skill).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

Depends on ROW-60 and ROW-62. Both are in `DONE`. Read the `story-dependencies` Spec and the `rowbly-tui-design` skill.

Existing code to use:

- `src/services/story-dependency/story-dependency.ts`: the pure functions `waitingFor`, `isBlocked`, `blocksOf`, `isComplete` and `dependencyError`. Do not put the blocked rule or the cycle rule in a component.
- Add one pure function in the same file, for example `dependencyCandidates(stories, id, dependsOn)`. It gives the IDs that the picker can show: not `id`, not in `dependsOn`, and `dependencyError(stories, id, [...dependsOn, candidate])` is `undefined`. For a new Story (no ID yet), all Stories are candidates. Add tests in `story-dependency.test.ts`.
- `src/services/story/story-types.ts`: `Story.dependsOn`, `UpdateStoryInput.dependsOn` / `addDependsOn` / `removeDependsOn`, `CreateStoryInput.dependsOn`. `getStoryDetails` gives `blocks` and `waitingFor` for one Story.
- `src/tui/shell/shell/use-shell-data.ts` loads the Stories with `searchStories({})` and the Stages with `listStages`. Each `Story` has `stage` and `dependsOn`, so the board calculates `waitingFor` and `blocksOf` with the pure functions. No new service call is necessary for the board.
- The board row is `src/tui/screens/stories/story-row/story-row.tsx`. It already shows `▧ <count>` and `▶ <agent>` slots on the right. Put the blocked mark and the `waiting for` text in the same row pattern.
- The picker: use `SearchableSelectPicker` (`src/tui/components/searchable-select-picker/`), with labels `<ID> <title>`.
- The Story form fields are in `src/tui/screens/stories/story-form.ts`. The General tab is `story-general-tab.tsx`. The new Story form is `new-story-form/new-story-form.tsx`.
- `stageCategory` (`src/tui/screens/stories/stage-category.ts`) gives `backlog`, `board` or `done` for a Stage.

Do not write tests for the TUI. Use `.js` extensions in relative imports. Follow the `rowbly-code-style` skill.

## Assumptions

- The "factory status line" of a Story is the activity slot of the Story row, where `▶ <agent>` shows now. A blocked Story in a work Stage with no active worker shows `waiting for <IDs>` in this slot. When a worker is active, the row shows `▶ <agent>`, because the factory does not stop a worker that runs. Reason: the TUI has no other status line for one Story. `FactoryStatusLine` shows only problems of the factory state file for the full Project.
- A "work Stage" in the TUI is a Stage with the `board` category (not the first Stage and not the last Stage). Reason: the TUI does not have the prompt class of the Stage that the policy uses, and Backlog and Done get no workers.
- The blocked mark shows on each blocked Story, in all Stages. Reason: the Spec defines "blocked" without a Stage condition.
- The blocked mark is one character, for example `⊘`, in `theme.inkMuted` or a warning colour of `theme`. The developer selects the character and the colour from the `rowbly-tui-design` skill.
- `Blocks` is read-only in the General tab. Reason: only the downstream Story keeps the relation (Spec, "Storage"), and the smallest scope is an edit of `Depends on` only.
- In the picker, a Story in the last Stage can be an upstream Story. Reason: the Spec does not forbid it, and the CLI accepts it.
