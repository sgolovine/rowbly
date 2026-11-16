---
title: Add `expandedByDefault` to rowbly config
stage: IN_REVIEW
position: 1
createdAt: 2026-11-16T16:34:16.401Z
updatedAt: 2026-11-16T16:40:50.700Z
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-72
pull_request: https://github.com/sgolovine/rowbly/pull/257
---

## Goal

The Stages are defined in the Rowbly config (`.rowbly/rowbly.config.json`). The user cannot set whether a Stage section is expanded or collapsed when the TUI starts. Today, all Stage sections in the All Stages view start expanded (`useShellState` starts `collapsed` as an empty set).

Add an optional `expandedByDefault` boolean to each Stage in the config. If it is `true`, the Stage section is expanded when the user starts the app. If it is `false`, the Stage section is collapsed.

## Scope

In scope:

- The optional key `expandedByDefault` on each entry of `stages` in `rowbly.config.json` (type, validation, normalization).
- Stage services keep the key: `updateStage` and the other Stage writes must not delete it.
- The `Stage` record from `getStage` / `listStages` (and so `stage get --json`) includes the key when it is set.
- The TUI applies the defaults to the All Stages view when a Project opens (at start and after a Project switch).
- Documentation of the key in `docs/architecture/storage.md` (and `docs/architecture/tui.md` where it describes collapsed sections).

Not in scope:

- New CLI flags on `stage create` / `stage update` to set the key. A user sets it by hand in the config file.
- A control in the TUI Stage form or the Settings screen to set the key.
- Saving the collapse state that the user changes in the TUI back to the config.
- The Thread sections of the factory view.

## Acceptance criteria

- [ ] `StageConfig` in `src/services/config/config-types.ts` has an optional `expandedByDefault?: boolean`.
- [ ] `configIssues` gives an issue at `stages.<n>.expandedByDefault` when the key is present and is not a boolean. A config without the key stays valid. A unit test in `src/services/config/config.test.ts` examines both cases.
- [ ] `parseConfig` and `writeConfig` keep `expandedByDefault` when it is set, and do not add it when it is not set. A unit test examines a round trip.
- [ ] `updateStage` (for example, a label change, a rename or an enable change) keeps the `expandedByDefault` value of the Stage. A test in `src/services/stage/stage.test.ts` examines this.
- [ ] A pure helper (for example `collapsedStageKeys(stages)` in the config or stage service) gives the keys of the Stages that have `expandedByDefault === false`. A unit test examines it. A Stage without the key is expanded.
- [ ] When the TUI opens a Project (start, or a Project switch), the All Stages view collapses each Stage that has `expandedByDefault: false`, and expands all other Stages. Only a person can examine this in the TUI.
- [ ] A reload of the board (for example after a Story change) does not reset the sections that the user expanded or collapsed. Only a person can examine this in the TUI.
- [ ] `docs/architecture/storage.md` documents the key in STE.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- Config types: `src/services/config/config-types.ts` (`StageConfig`).
- Validation: `stageIssues` in `src/services/config/config-issues.ts`. Add a check like the `enabled` check, but the key is optional.
- Normalization: `normalizeConfig` in `src/services/config/config.ts` maps stages to `{ key, label, enabled }` and so drops unknown keys. Add `expandedByDefault` only when it is not `undefined`, to keep existing config files unchanged.
- Stage service: `src/services/stage/stage.ts`. `updateStage` builds a new `StageConfig` object `{ key, label, enabled }`; it must copy `expandedByDefault` from the old Stage. `createStage` does not need a new input.
- TUI: the collapsed set is state in `src/tui/shell/shell/use-shell-state.ts` (`useState(new Set())`). The board (with `stages`) loads asynchronously in `src/tui/shell/shell/use-shell-data.ts`. `switchProject` in `src/tui/shell/shell/shell-selection.ts` resets the set to empty. Apply the defaults one time for each Project root when its board first loads (for example, an effect in `use-shell.ts` that tracks the root it initialized), not on each reload. Keep the domain logic (which keys to collapse) in the service helper; the TUI only calls it.
- Follow `.agents/skills/rowbly-code-style/SKILL.md` and `.agents/skills/rowbly-tui-design/SKILL.md`. Do not write TUI tests.
- If `skills/rowbly-reference.md` shows the Stage shape, it does not need a change; the key is optional. If you change it, copy it to each `skills/<name>/references/rowbly-reference.md`.

## Assumptions

- A Stage without `expandedByDefault` is expanded. Reason: this is the current behaviour, and existing config files must not change behaviour.
- The key is optional and is not written when it is not set. Reason: existing config files stay unchanged, and `rowbly doctor` does not need a fix.
- CLI flags and a TUI control to set the key are not in scope. Reason: the Story asks only for the config key; this is the smallest scope. A person can add a follow-up Story.
- The defaults apply only when a Project opens, not when the config changes while the TUI runs. Reason: a reload must not undo the expand or collapse actions of the user.
- The key affects only the All Stages view. A single-Stage filter shows its Stories without sections, so the key has no effect there. Reason: the existing code shows sections only in All Stages.
