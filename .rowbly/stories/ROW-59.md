---
title: Store Story dependencies in the Story service
stage: IN_REFINEMENT
position: 2
worktree: null
pull_request: null
---

## Goal

Store the dependencies of a Story in the Story service. Each later Story of the `story-dependencies` Spec uses this service.

## Scope

- Add `dependsOn: string[]` to `Story` in `src/services/story/story-types.ts`. Also add `dependsOn?: readonly string[]` to `CreateStoryInput` and `UpdateStoryInput`. On update, a list replaces the old list, and an empty list removes the key.
- Read and write the frontmatter key `dependsOn` in `src/services/story-files/story-files.ts`. Put it after `position` and before the custom fields. Do not write the key when the list is empty.
- Add a pure module `src/services/story-dependency/story-dependency.ts`. It does no I/O. It has these functions:
  - `dependencyError(stories, id, dependsOn)`: gives the first validation problem (unknown ID, ID of a different Project, self, cycle) or nothing.
  - `findCycle(stories)`: gives one cycle as a list of IDs, or nothing.
  - `blocksOf(stories, id)`: the downstream Stories of a Story.
  - `waitingFor(stories, stages, id)`: the upstream Stories that are not in the last Stage.
  - `isBlocked(stories, stages, id)`.
- `createStory` and `updateStory` validate `dependsOn` with `dependencyError` under the Project write lock. A problem gives a `ValidationError` with `details` (for example `{ unknown: ["ROW-99"] }` or `{ cycle: ["ROW-03", "ROW-01", "ROW-03"] }`). Nothing is saved.
- Remove duplicates and keep the order of the input.
- `deleteStory` removes the deleted ID from the `dependsOn` list of each downstream Story in the same write, and gives a warning for each changed Story.

## Acceptance criteria

- [ ] A Story file without `dependsOn` reads as `dependsOn: []` and does not change on a write of a different key.
- [ ] Create and update save the list in the given order, without duplicates.
- [ ] An unknown ID, a self reference and a cycle each give a `ValidationError`, and no file changes.
- [ ] A delete of an upstream Story removes its ID from each downstream Story and gives a warning.
- [ ] `story-dependency.test.ts` covers each function, also a cycle of three Stories and a Story in the last Stage.
- [ ] `docs/architecture/storage.md` and `docs/architecture/domain-concepts.md` describe `dependsOn`, Upstream Story, Downstream Story, Blocked and Ready, in STE.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

Read the `story-dependencies` Spec first. It has the words and the rules.
"Complete" means the last Stage of the board. See `stageCategory` in `src/tui/screens/stories/stage-category.ts` for the same rule in the TUI. Put the rule in the service and let the TUI use it later.
The validation needs all Stories. Read the Story file names and only the frontmatter that is necessary. Do not read each Story more than one time.
