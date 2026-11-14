---
title: Allow overriding AI worker model
stage: DONE
position: 19
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-20
pull_request: https://github.com/sgolovine/rowbly/pull/202
---

## Goal

Today each worker of the native factory uses one model: `workerModel` in `.rowbly/factory.json` (or a model that the supervisor gives to `start_worker`). The user wants to override the worker model:

- At the Stage level. The override applies to all Stories in that Stage. Example: a different model for `IN_REFINEMENT`.
- At the Story level, for each Stage. Example: "for this Story, use model X in Refinement and model Y in Development". A Story override has priority over a Stage override.

The order of priority is:

1. Story override for the Stage of the worker (highest).
2. Stage override (only if there is no Story override).
3. The settings model, `workerModel` (only if there is no Stage or Story override).

## Scope

In scope:

- Storage of Stage and Story worker model overrides in `.rowbly/factory.json`.
- Service functions to set, clear and resolve the overrides.
- Use of the resolved model when the native factory starts a worker.
- CLI flags on `rowbly factory configure` to set and clear an override.
- Tests and documentation for the above.

Not in scope:

- The TUI to see, set and clear overrides. This is ROW-21.
- Overrides for the supervisor model.
- Automatic removal of overrides when a Story or a Stage is deleted or renamed. An override for an unknown Story or Stage is ignored.

## Acceptance criteria

- [ ] `FactorySettings` accepts optional `stageWorkerModels: Record<stageKey, ModelChoice>` and `storyWorkerModels: Record<storyId, Record<stageKey, ModelChoice>>`. `getFactorySettings` gives `ValidationError` ("Invalid factory settings") if an entry is not a valid `ModelChoice` (`validModel`). A `factory.json` without these keys stays valid and is read as before.
- [ ] A pure service function `resolveWorkerModel(settings, storyId, stage)` returns the Story override for that Stage, else the Stage override, else `settings.workerModel`, else `undefined`. Unit tests cover each of the 4 results, and a Story override for a different Stage that does not apply.
- [ ] `rowbly factory configure --stage <key> --worker <provider/model> [--worker-thinking <level>] --json` writes `stageWorkerModels[<key>]` and does not change `workerModel`.
- [ ] `rowbly factory configure --story <id> --stage <key> --worker <provider/model> [--worker-thinking <level>] --json` writes `storyWorkerModels[<id>][<key>]`.
- [ ] `rowbly factory configure --stage <key> [--story <id>] --clear-worker --json` removes that override. If the Story then has no overrides, its key is removed from `storyWorkerModels`. Clearing an override that does not exist succeeds and changes nothing.
- [ ] These inputs give exit code 1 and error code `VALIDATION`, and do not write `factory.json`: `--story` without `--stage`; `--clear-worker` without `--stage`; `--clear-worker` together with `--worker`; `--stage` together with `--supervisor`, `--supervisor-thinking` or `--max-workers`; an unknown Stage key. An unknown Story ID gives `NOT_FOUND`.
- [ ] The model of an override is validated with `validateModelChoice` (the same check as `--worker` today) before the file changes.
- [ ] When the factory reserves a worker (`reserveWorkerSlot` in `src/services/factory-manager/worker-reservation.ts`), the model is: Story override for the Story Stage, else Stage override, else the `model` of `start_worker`, else `workerModel`. The resolved model is stored on the Thread (`model`) as today. A test with the faux provider or with injected settings shows that a Stage override and a Story override are used.
- [ ] The `start_worker` tool description tells the supervisor that a Story or Stage override in `factory.json` has priority over its `model` argument.
- [ ] `docs/architecture/native-factory/pi-runtime-and-auth.md`, `controls.md`, `runtime-and-locks.md` and `docs/architecture/storage.md` describe the new keys, the flags and the order of priority, in STE.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- Settings: `src/services/factory-settings/factory-settings.ts` (`FactorySettings`, `validate`, `updateFactorySettings`, `configureFactory`, `chooseRole`). Add the new functions there, or in a new file in the same folder. The service must not load Pi except through the lazy `import("../agent-auth/agent-auth.js")` that `configureFactory` uses now.
- `updateFactorySettings` merges at the top level. To set one override, read the current map, copy it and change one entry. Keep all other keys of `factory.json`.
- Stage keys: validate with `lookupStage` / `readConfig` (`src/services/stage/stage.ts`, `src/services/config/`). Story IDs: validate with `getStory` (`src/services/story/story.ts`).
- CLI: `registerConfigure` in `src/commands/factory/factory.ts`. Keep the command thin. Update `src/commands/factory/factory.test.ts` (or the nearest test).
- Factory: `src/services/factory-manager/worker-reservation.ts` line `const choice = input.model ?? getState(manager).settings.workerModel;`. `worker-launch.ts` uses `intent.model ?? settings.workerModel`; it can stay, because the reservation stores the resolved model on the Thread. The supervisor loop reads `factory.json` again on each turn (`supervisor-loop.ts`), so a changed override applies to the next reservation without a restart.
- A resumed Thread (`resumeThreadId`) gets a new reservation, so it also uses the resolution.
- `.rowbly/factory.json` is committed. `state.json` and `runtime/` are not.
- Example `factory.json`:

  ```json
  {
    "version": 1,
    "maxWorkers": 4,
    "workerModel": { "provider": "anthropic", "modelId": "claude-opus-5-5" },
    "stageWorkerModels": { "IN_REFINEMENT": { "provider": "openai", "modelId": "gpt-sol" } },
    "storyWorkerModels": { "ROW-20": { "IN_DEVELOPMENT": { "provider": "anthropic", "modelId": "claude-opus-5-5", "thinkingLevel": "high" } } }
  }
  ```

## Assumptions

- The overrides are stored in `.rowbly/factory.json`, not in the Story frontmatter or in `rowbly.config.json`. Reason: `factory.json` already holds the worker model and its validation, and the factory reads it again on each turn. Story frontmatter keys are custom fields, and a nested object there would need changes to the Story schema and to `doctor`.
- A Story or Stage override has priority over the `model` argument of the supervisor tool `start_worker`. The `start_worker` model has priority over `workerModel`. Reason: the author says that the overrides have priority over the settings model. The Project instructions tell the supervisor to select models for each Thread, so if `start_worker` had priority, an override would almost never apply.
- An override holds a full `ModelChoice` (provider, model and optional thinking level). Reason: this is the same shape as `workerModel`, and it uses the existing validation.
- The CLI uses `rowbly factory configure` with `--stage`, `--story` and `--clear-worker`, and no new command. Reason: `factory configure` already sets the worker model. This is the smallest change.
- An override for a deleted or renamed Story or Stage stays in the file and is ignored. Reason: smallest scope. Removal on delete or rename can be a later Story.
- The TUI part is split to ROW-21. Reason: one pull request for the services, the factory, the CLI and the TUI is too large.
- The earlier `chore(rowbly)` commits stay on `story/ROW-20`. Reason: a removal needs a history rewrite and a force push of a shared branch, and the repository rules do not permit this without a person. The merge of `main` (commit `2f15b520`) repairs the merge conflicts.
