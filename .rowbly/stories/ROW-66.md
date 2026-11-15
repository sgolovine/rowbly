---
title: "Optional: move a stuck upstream Story out of Backlog automatically"
stage: IN_DEVELOPMENT
position: 3
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-66
pull_request: null
---

## Goal

When an upstream Story stays in Backlog, its blocked downstream Stories wait, and only a person can start the work. ROW-63 shows an `upstream-stuck:<id>` attention entry for this case. As an option that is off by default, the factory moves the stuck upstream Story out of Backlog itself, so that the upstream work starts without a person.

## Scope

In scope:

- A new factory setting `dependencies.pullUpstream` (boolean) in the `factory` section of `.rowbly/rowbly.config.json`. The default is `false` (an absent key is `false`). Read and validate it in `src/services/factory-settings/`, as the other settings. `validFactorySettings` (and so `rowbly doctor`) refuses a value that is not a boolean.
- A manager step in each supervisor pass. When the setting is `true`, for each blocked Story in a `work` Stage, the manager finds all its upstream Stories that are not complete, also the indirect ones (the upstream Stories of an upstream Story). The manager moves each of these Stories that is in the first Stage of the board to the first enabled Stage with the prompt class `work`.
- The manager moves each Story with `updateStory` of the Story service, inside `projectWrite` (the Project write lock). It does not hold the state lock at that time.
- The manager commits the moves in a canonical commit with a clear message, for example `chore(rowbly): move ROW-04 out of Backlog for ROW-05`.
- The manager does not move a Story that is parked (an entry in `state.parked`) or in a `hold` Stage. The `upstream-stuck:` attention of ROW-63 stays for these Stories.
- `rowbly factory configure --pull-upstream on|off` changes the setting. Other values give the error code `VALIDATION`.
- The Settings › AI section shows the setting in a card on the Limits tab, with a key that switches it.
- Docs in STE: `docs/architecture/native-factory/pi-runtime-and-auth.md` and `docs/architecture/native-factory/controls.md`. Also `docs/architecture/native-factory/README.md` where it describes the `upstream-stuck:` attention.

Not in scope:

- A move from a Stage that is not the first Stage (for example from a `hold` Stage or for a parked Story).
- A move of a Story that has no blocked downstream Story in a `work` Stage.
- A change of the policy gate, the launch order or the `start_worker` refusal (ROW-62).
- A per-Stage target Stage. The target is always the first `work` Stage.

## Acceptance criteria

- [ ] `getFactorySettings` gives `dependencies.pullUpstream` as `false` when the key is absent. A `factory` section with `dependencies.pullUpstream: "yes"` is not valid. A test in `factory-settings.test.ts` examines both.
- [ ] `rowbly factory configure --pull-upstream on` writes `"dependencies": { "pullUpstream": true }` to the `factory` section, and `--pull-upstream off` writes `false`. The other keys of the config do not change. `--pull-upstream maybe` gives the error code `VALIDATION` and writes nothing. A test examines it.
- [ ] With the setting `false`, ROW-05 in a `work` Stage and ROW-04 (its upstream Story) in Backlog: after a supervisor pass, ROW-04 stays in Backlog and the `upstream-stuck:ROW-04` attention entry shows. A test examines it.
- [ ] With the setting `true` and the same Stories: after a supervisor pass, ROW-04 is in the first `work` Stage, the `upstream-stuck:ROW-04` entry is not there, and the next policy scan gives a `start` decision for ROW-04. A test with the faux provider examines it.
- [ ] With the setting `true`, ROW-05 in a `work` Stage depends on ROW-04, and ROW-04 depends on ROW-03; ROW-04 and ROW-03 are in Backlog: after one pass, both ROW-04 and ROW-03 are in the first `work` Stage. A test examines it.
- [ ] With the setting `true`, a parked upstream Story and an upstream Story in a `hold` Stage do not move, and the `upstream-stuck:` entry shows for each. A test examines it.
- [ ] With the setting `true`, a blocked downstream Story in Backlog (not a `work` Stage) causes no move. A test examines it.
- [ ] The move happens outside `updateFactoryState` and outside `withStateLock`. A test or a code review examines that `projectWrite` is not called while the state lock is held.
- [ ] After a move, the canonical Git history has a commit whose message names the moved Story IDs. A test examines the commit message.
- [ ] Settings › AI › Limits shows a card "Pull upstream Stories" with the value `On` or `Off`, and its key switches the setting. Only a person can examine this criterion (no TUI tests).
- [ ] Tests use the faux provider. No test runs a real Pi model.
- [ ] `docs/architecture/native-factory/pi-runtime-and-auth.md` and `controls.md` describe the setting and the flag, in STE.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- Depends on ROW-63 (DONE, merged to `origin/main` in PR #237). The worktree HEAD is older than `origin/main` and does not have the ROW-63 code. Start the branch from `origin/main`.
- Read the `story-dependencies` Spec (`.rowbly/specs/story-dependencies.md`), section "Factory".
- Settings: `src/services/factory-settings/factory-settings.ts` (`FactorySettings`, `validSettings`, `ConfigureInput`, `writeSettings`). Add the key as `dependencies?: { pullUpstream?: boolean }`, with a small helper (for example `pullUpstream(settings): boolean`). The settings are in the `factory` section of `rowbly.config.json`, not in `.rowbly/factory.json` (the legacy file, see `assertNoLegacyFactorySettings`).
- CLI: `src/commands/factory/factory.ts`, command `configure`. Add `--pull-upstream <on|off>`. Keep the logic in the service.
- Manager: `src/services/factory-manager/supervisor-loop.ts`, `superviseOnce`. Add the step after `reconcilePolicy` and before `refreshUpstreamAttention`, so that the attention reflects the moves. Put the pure rule (which Stories move, and to which Stage) in a module without I/O next to `upstream-attention.ts` (for example `upstream-pull.ts`), and reuse `waitingFor`, `isComplete` (`src/services/story-dependency/`) and `workStageKeys` (`dependency-facts.ts`). The Stages come from `classifiedStages(manager)`; the parked map from `readFactoryState(...).parked`.
- Lock order: `projectWrite` (`src/services/project-write/project-write.ts`) takes the Project write lock. `updateFactoryState` takes the state lock. Never call `projectWrite` inside `updateFactoryState` or `withStateLock` (`AGENTS.md` safety rule). `worker-launch.ts` `assignWorktree` shows the correct pattern for `updateStory` inside `projectWrite`.
- Commit: `commitProjectFiles(root, { message, author })` in `src/services/project-write/project-commit.ts`, inside `projectWrite`, with the author from `formatAuthor(settings.git)`. Skip the dedicated commit while a Git sync runs (`getState(manager).syncTask`, as `commitProject` in `supervisor-steps.ts` does); the normal commit step then commits the move.
- A failure of the move step records an attention entry (for example key `pull-upstream`) with `runStep`-style handling, and the pass continues.
- TUI: `src/tui/screens/settings/ai-limits-page/ai-limits-page.tsx` and `ai-section/` (`ai-actions.ts`). Read the `rowbly-tui-design` skill. Use `AiSettingCard`.
- Tests: `src/services/factory-manager/factory-manager.test.ts` has the ROW-63 `upstream-stuck` tests to copy from. Add tests for the pure rule next to it.
- This Story is optional. A move changes the board of the user, so the setting is off by default.

## Assumptions

- The setting is in the `factory` section of `.rowbly/rowbly.config.json`, not in `.rowbly/factory.json`. Reason: the original text named `factory.json`, but Rowbly no longer reads that file; all factory settings are in the config.
- The target Stage is the first enabled Stage with the prompt class `work` in board order. If no such Stage exists, nothing moves. Reason: smallest scope; a worker starts only in a `work` Stage.
- All indirect upstream Stories in Backlog move in the same pass. Reason: the author asks for indirect Stories to move; one pass gives one commit and fewer scans.
- An indirect upstream Story moves only when a downstream Story in a `work` Stage waits (directly or indirectly) for it. Reason: same trigger as the ROW-63 attention.
- The moves get a dedicated canonical commit with a message that names the moved and the waiting Story IDs. This commit also takes other uncommitted canonical changes at that time. Reason: the configured `git.commitMessage` is one subject for all commits and cannot name the move; a separate commit is the clear record that the author asks for.
- The CLI flag takes `on|off` as written by the author, not `--pull-upstream`/`--no-pull-upstream`. Reason: keep the text of the author.
- The TUI card is on the Limits tab of Settings › AI. Reason: it is the tab for factory behaviour settings that are not models, providers or checks.
