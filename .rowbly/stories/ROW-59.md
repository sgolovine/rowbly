---
title: Store Story dependencies in the Story service
stage: CHANGELOG
position: 1
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-59
pull_request: https://github.com/sgolovine/rowbly/pull/231
---

## Goal

Store the dependencies of a Story in the Story service. Each later Story of the `story-dependencies` Spec (ROW-60 to ROW-66) uses this service. After this change, a service caller can set `dependsOn` on a Story, the service rejects bad lists, and pure functions calculate Blocked, Ready, `blocks` and `waitingFor`.

## Scope

In scope:

- Add `dependsOn: string[]` to `Story` in `src/services/story/story-types.ts`. Also add `dependsOn?: readonly string[]` to `CreateStoryInput` and `UpdateStoryInput`. On update, a list replaces the old list, and an empty list removes the key. When `dependsOn` is `undefined` on update, the old value stays unchanged.
- Read and write the frontmatter key `dependsOn` in `src/services/story-files/story-files.ts`. Put it after `position` and before the custom fields (add it to `LEADING_KEYS`). Do not write the key when the list is empty.
- Read `dependsOn` in `toStory` (`src/services/story/story-read.ts`). A missing key gives `[]`.
- Add a pure module `src/services/story-dependency/story-dependency.ts` with a test `story-dependency.test.ts`. It does no I/O. It has these functions:
  - `dependencyError(stories, id, dependsOn)`: gives the first validation problem (unknown ID, ID of a different Project, self, cycle) or nothing.
  - `findCycle(stories)`: gives one cycle as a list of IDs, or nothing.
  - `blocksOf(stories, id)`: the downstream Stories of a Story.
  - `waitingFor(stories, stages, id)`: the upstream Stories that are not in the last Stage.
  - `isBlocked(stories, stages, id)`.
  - `isComplete(stages, stageKey)`: `true` only for the last Stage. This is the one rule for "Complete".
- `createStory` and `updateStory` validate `dependsOn` with `dependencyError` in the same service call as the write. A problem gives a `ValidationError` with `details` (for example `{ unknown: ["ROW-99"] }`, `{ self: ["ROW-03"] }` or `{ cycle: ["ROW-03", "ROW-01", "ROW-03"] }`). The message names the cycle as `ROW-03 → ROW-01 → ROW-03`. Nothing is saved.
- Remove duplicates and keep the order of the input. Save each ID in the canonical form (`row-1` and `1` become `ROW-01`).
- `deleteStory` removes the deleted ID from the `dependsOn` list of each downstream Story in the same call, and gives a warning for each changed Story. The result type becomes `{ id: string; warnings: string[] }`. The CLI `story delete` prints each warning after `Deleted <id>` in text mode. With `--json` the warnings are in the result object.
- `updateProject` with a new key (`renameStoryKey` in `src/services/project/project.ts`) also changes the IDs in each `dependsOn` list to the new key.
- Docs: `docs/architecture/storage.md` and `docs/architecture/domain-concepts.md`.

Not in scope:

- CLI flags `--depends-on`, `--add-dependency`, `--remove-dependency`, and `blocks` or `waitingFor` in `story get` (ROW-60).
- `rowbly doctor` checks for bad dependencies (ROW-61).
- The factory policy, supervisor, worker messages and TUI (ROW-62 to ROW-66).
- A change of `stageCategory` in the TUI. The TUI can use `isComplete` later.

## Acceptance criteria

- [ ] A Story file without `dependsOn` reads as `dependsOn: []`. An update of a different key (for example the title) does not add a `dependsOn` key to the file. A test examines the bytes of the file.
- [ ] Create and update save the list in the given order, without duplicates, in canonical ID form, with `dependsOn` after `position` and before the custom fields.
- [ ] An update with `dependsOn: []` removes the key from the file. An update without `dependsOn` keeps the old list.
- [ ] An unknown ID, an ID of a different Project key, a self reference and a cycle each give a `ValidationError` with `details`, and no Story file changes. A test examines the cycle `ROW-03 → ROW-01 → ROW-03`.
- [ ] A delete of an upstream Story removes its ID from each downstream Story and gives one warning for each changed Story. A delete of a Story with no downstream Stories gives `warnings: []`.
- [ ] A change of the Project key changes the IDs in each `dependsOn` list.
- [ ] `story-dependency.test.ts` covers each function, also a cycle of three Stories, a Story in the last Stage (complete) and a Story in a Stage before the last Stage (not complete).
- [ ] `docs/architecture/storage.md` and `docs/architecture/domain-concepts.md` describe `dependsOn`, Upstream Story, Downstream Story, Complete, Blocked and Ready, in STE.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

Read the `story-dependencies` Spec first (`.rowbly/specs/story-dependencies.md` in the canonical Project). It has the words and the rules.

- "Complete" means the last Stage in the order of `config.stages`. `stageCategory` in `src/tui/screens/stories/stage-category.ts` uses the same rule in the TUI. Put the rule in `story-dependency.ts`. Do not import TUI code into the service.
- The pure functions take minimal inputs, for example `stories: readonly { id: string; stage: string; dependsOn: readonly string[] }[]` and `stages: readonly { key: string }[]`, so that the factory policy can use them later without a full `Story`.
- The validation needs all Stories. `createStory` and `updateStoryFields` already call `readStoryFiles` one time. Use that list for the validation. Do not read each Story more than one time.
- The ID parse rule is in `parseStoryId` (`story-read.ts`) and `canonicalStoryId` (`spec-files.ts`). Use them; do not add a third parse rule.
- `deleteStory` reads the Story files one time, rewrites each downstream Story (use `writeStoryFile` or `rewriteStories`), then removes the file. Keep the existing removal of attachments and Spec links.
- The CLI result of `story delete` in `src/commands/story/story.ts` must stay thin. It only prints `result.warnings`. Update `src/commands/story/story.test.ts` if it examines the delete output.
- Update `src/services/story/story.test.ts`, `story-read.test.ts`, `story-files.test.ts` and the project test for the key rename.
- Obey the `rowbly-code-style` skill and the STE rules for docs.

## Assumptions

- The services do not take the Project write lock themselves. "Under the Project write lock" means that the validation and the write occur in the same service call, so the lock of the caller covers both. Reason: the caller already holds the lock (the factory calls `projectWrite`, agents use the `flock` command prefix). A second `projectWrite` in the service would wait for the lock of its own caller and fail after 60 seconds.
- A `dependsOn` value that is not a list reads as `[]`, and items that are not strings are ignored in `toStory`. The service does not throw for it, and a write of a different key keeps the bad value unchanged. Reason: a bad value must not make the board unreadable. ROW-61 adds the `doctor` check for it.
- The IDs are saved in canonical form (`ROW-01`). Reason: the existing ID rules accept `row-1` and `1`, and one canonical form keeps the files and the comparisons simple.
- `deleteStory` gives `warnings: string[]`, also when the list is empty. Reason: the onboarding service already uses a `warnings: string[]` key, and one shape is simpler for the CLI.
- The key rename in `updateProject` is in scope. Reason: without it, a key change breaks all dependencies. The change is small and uses the existing `canonicalStoryId` rule.
- A Story in a disabled last Stage is complete. Reason: the Spec defines Complete as the last Stage of the board, and `stageCategory` uses the full Stage list.
