---
title: Sometimes factory will get stuck on "stage prompt not classified"
stage: IN_DEVELOPMENT
position: 2
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-23
pull_request: null
---

Occasionally, the factory gets stuck on "stage prompt not classified" and does not run workers.
The original request: investigate why this occurs, and fix the issue.

## Goal

A Story in a Stage with an unclassified prompt must not wait for a long time. The supervisor must
get a digest that lists the unclassified Stage, so that it can call `classify_stage`. Today some
failures in the supervisor loop stop all digests. Then the Story stays on
"stage prompt not classified" until the user restarts the factory. The user also cannot see why the
factory does not move.

## Investigation (done in refinement)

Evidence from the canonical Project on 2026-11-14 (times are UTC):

- Commit `5687f245` (18:05) changed the Stage prompts. The stored classes in `state.json` `prompts`
  kept the old hashes (for example `IN_REFINEMENT` `d6d40103823efc4c`). Thus `IN_REFINEMENT` and
  `IN_DEVELOPMENT` became `unclassified`. This is correct behaviour.
- The supervisor `93a53c28` got its last digest at 18:21. The daemon `09ca180f` continued to run
  until 20:11, but it sent no digest for almost two hours.
- `ROW-22` was in `IN_REFINEMENT` at 19:32 (commit `1d1f4640`). It did not get a worker. Its reason
  was "stage prompt not classified".
- At 20:11 the user restarted the factory. The new supervisor `a9731f36` got
  `unclassified: [IN_REFINEMENT]` in its first digest. It classified the Stage in 5 seconds and
  started workers.
- During this time the user made commits and merges in the canonical checkout, and moved the
  factory settings into `rowbly.config.json` (`aab05c6a`).
- The status file of the current daemon has the attention entry
  `reconcile: "Project reconciliation failed; retry on the next scan"`. The text does not give the error.

Thus classification operates when a digest arrives. The problem is that the digest does not arrive.

Causes in the code (`src/services/factory-manager/supervisor-loop.ts`):

1. `superviseOnce()` runs `reconcilePolicy`, `refreshSettings`, `clearProviderPauses`,
   `commitProject` and `startProjectSync` before `buildDigest`. If one of them throws, the pass stops
   before the digest. If the failure repeats on each pass (for example, `commitCanonicalProject`
   throws `ConflictError("Project write lock is unavailable")` because a different process holds the
   Project write lock), the supervisor never gets a digest again.
2. `recordReconcileFailure()` writes a fixed text with no error message, and nothing removes the
   `reconcile` entry after a pass that succeeds. The user cannot find the cause.
3. The heartbeat continues to write `status.json`. Thus the TUI shows "stage prompt not classified"
   as if the factory waits for a normal step.

## Scope

In scope:

- Isolate the steps in `superviseOnce()` that the digest does not need: `refreshSettings`,
  `clearProviderPauses`, `commitProject` and `startProjectSync`. A failure in one of these steps
  records an attention entry and the pass continues to `buildDigest` and the delivery.
- Keep `reconcilePolicy` before the digest. The digest uses the same scan. If the scan fails, the
  pass stops and the 30 second timer retries it (current behaviour).
- Put the error message in the attention text of each failure. Limit the text to 500 characters.
- Remove the `reconcile` attention entry after a pass that completes `reconcilePolicy` with no error.
- Tests for each item. Update `docs/architecture/native-factory/` if a document describes the loop steps.

Not in scope:

- A change to how the policy classifies a Stage. A changed prompt hash continues to make the Stage
  `unclassified`. The supervisor must classify it again.
- A time limit for a supervisor turn that does not end.
- Authentication pauses of the supervisor provider. They clear after a credential change, by design.
- The order of the `workers` list in the digest.

## Acceptance criteria

- [ ] A test makes `commitCanonicalProject` (or the commit step) throw on each pass. A Story is in a
      Stage with an unclassified prompt. The supervisor still gets a digest with this Stage in
      `unclassified`.
- [ ] In the same test, the manager attention has a `commit` entry. Its text contains the error message.
- [ ] A test makes `startProjectSync`, `refreshSettings` or `clearProviderPauses` throw. The digest
      is still delivered, and the attention has an entry for the failed step with the error message.
- [ ] A test makes `reconcilePolicy` (the scan) throw one time. The `reconcile` attention text
      contains the error message. After the next pass that succeeds, the `reconcile` entry is not
      in the attention and not in `status.json`.
- [ ] Each attention text from these failures has a maximum of 500 characters.
- [ ] The existing factory-manager tests pass. Especially "classifies the fresh prompt through real
      Pi tools before a reservation" and the test that expects `["commit", { text: "Canonical commit: failed" }]`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- `src/services/factory-manager/supervisor-loop.ts`: `superviseOnce()`, `recordReconcileFailure()`,
  `commitProject()`, `refreshSettings()`, `clearProviderPauses()`.
- `src/services/factory-manager/project-sync-step.ts`: `startProjectSync()`. The sync itself runs
  outside `serial` and records its own `push`/`pull` attention. Only a synchronous throw of the start
  must be isolated.
- `src/services/factory-manager/manager-status.ts`: `classifiedStages()`, `scan()`, `persistStatus()`.
- `src/services/factory-manager/supervisor-tools.ts`: `classifyStage()` rejects a stale hash with
  `ConflictError("Stage prompt changed")`. Do not change it.
- `src/services/factory-policy/factory-policy.ts`: `stageSkipReason()` gives "stage prompt not classified".
- `src/services/project-write/project-write.ts`: `projectWrite()` throws `ConflictError` after 60
  seconds when it cannot get the lock. `commitProjectFiles()` returns a status and does not throw for Git errors.
- Use `withEntry` and `withoutEntry` from `src/services/store/store.js` for the attention map.
- Use the error message: `error instanceof Error ? error.message : String(error)`.
- Tests are in `src/services/factory-manager/factory-manager.test.ts`. Use the faux provider and the
  existing `fixture()`. Do not use live credentials.
- Obey the lock order: do not take the Project write lock while you hold the state lock.

## Assumptions

- The repeated failure of a pre-digest step is the cause of the stuck state. Reason: the daemon ran
  for almost two hours with no digest while a Story waited in an unclassified Stage, and a restart
  repaired it at once. The runtime has no manager log that gives the exact error. The fix makes the
  digest independent of the steps that it does not need, and records the error, so that a new case
  shows its cause.
- Attention keys: use `commit` for the commit step (existing key), `settings` for `refreshSettings`,
  `providers` for `clearProviderPauses`, `sync` for `startProjectSync` and `reconcile` for the scan.
  Reason: the smallest change that agrees with the existing keys.
- A failed `refreshSettings` keeps the current settings (current behaviour with `.catch`). Reason: no
  change of behaviour is necessary there; only the attention entry is new.
- The `commit` attention entry is removed after a commit with the status `clean` or `committed`.
  Reason: an old entry must not stay after the problem is gone, the same as the `reconcile` entry.
