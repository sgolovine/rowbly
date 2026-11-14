---
title: Hold blocked Stories in the factory policy and start upstream Stories first
stage: CHANGELOG
position: 1
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-62
pull_request: https://github.com/sgolovine/rowbly/pull/235
---

## Goal

The factory does not start a worker for a blocked Story. When the worker limit applies, the factory starts the upstream Stories first. Thus a downstream worker always starts from a main branch that has the upstream code. This Story is part of the `story-dependencies` Spec.

## Scope

In scope:

- Add `dependsOn?: readonly string[]` to `PolicyStory` in `src/services/factory-policy/policy-types.ts`. Add `waitingFor?: string[]` to `PolicyDecision`.
- The gate in `planStory` (`src/services/factory-policy/factory-policy.ts`): after the Stage checks (`stageSkipReason`) and before the harness worker check and `planAttempts`, skip a blocked Story with the decision `skip`, the reason `waiting for ROW-01, ROW-02` and `waitingFor: ["ROW-01", "ROW-02"]`.
- A blocked Story records no attempt, uses no attempt budget and is never parked because it is blocked. The gate does not change `state` for the Story.
- A Story that becomes ready gets the decision `start` with the reason `new stage stay` on the next scan, when it has no attempt in its current Stage stay. This is the same rule as for a Story that comes into the Stage.
- The new order in `limitWorkers`:
  1. The Stage nearest to the last Stage first (the existing rule).
  2. Then the Story with more blocked downstream Stories first. Count the direct and the indirect downstream Stories, each one time, and do not count a complete Story.
  3. Then the order of the board (the order of `input.stories`).
- `start_worker` refuses a blocked Story. `reserveWorkerSlot` in `src/services/factory-manager/worker-reservation.ts` already calls `scan` and throws `ConflictError("Story is not eligible: <reason>")` for a `skip` decision. With the gate, the error text is `Story is not eligible: waiting for ROW-01, ROW-02`, and no Thread is created. Keep this path. Change it only if a test shows that it does not give this error.
- A worker that runs when its Story becomes blocked again continues. The gate does not stop, cancel or interrupt a worker.
- Docs: the Policy item in `docs/architecture/native-factory/README.md`.

Not in scope:

- The check queue order (`src/services/check-queue/check-order.ts`). It keeps the Stage order only.
- The dependencies in the supervisor digest and the attention for a stuck upstream Story (ROW-63).
- The upstream Stories in the worker message (ROW-64).
- The TUI (ROW-65) and the automatic move of a stuck upstream Story (ROW-66).
- The CLI flags for dependencies (ROW-60) and the `doctor` checks (ROW-61).

## Acceptance criteria

- [ ] With the five Stories of the Spec example (03 depends on 01 and 02, 05 depends on 04) in a work Stage, the first scan gives `start` only for 01, 02 and 04. 03 gets `skip` with the reason `waiting for <01>, <02>` and `waitingFor` with both IDs. 05 gets `skip` with `waiting for <04>`.
- [ ] When 01 and 02 are in the last Stage, the next scan gives `start` with the reason `new stage stay` for 03. When 04 is in the last Stage, the next scan gives the same for 05.
- [ ] When only 01 is in the last Stage, 03 stays blocked with the reason `waiting for <02>`.
- [ ] With `maxActive: 1`, and an upstream Story and an unrelated Story in the same Stage, the upstream Story gets `start`, and the unrelated Story gets `skip` with the reason `worker limit`. The unrelated Story is before the upstream Story in the board order.
- [ ] With `maxActive: 1`, a Story with an indirect downstream Story (A ← B ← C) starts before a Story with one direct downstream Story only.
- [ ] With `maxActive: 1`, a Story in a later Stage starts before an upstream Story in an earlier Stage.
- [ ] A blocked Story over more scans than the attempt limit is never in `state.parked`, and `state.attempts` has no record for it.
- [ ] A Story in a hold Stage (for example Backlog) with an upstream Story that is not complete gets the reason `hold stage`, not `waiting for`.
- [ ] A running worker of a Story that becomes blocked again stays in `state.attempts` with its status, and the decision for the Story is `skip`.
- [ ] In `factory-manager.test.ts`, `reserveWorker` for a blocked Story rejects with an error that contains `waiting for` and the upstream ID, and no worker Thread starts. The test uses the faux provider.
- [ ] `factory-policy.test.ts` covers each policy criterion above.
- [ ] The Policy item in `docs/architecture/native-factory/README.md` describes the gate and the launch order, in STE.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- ROW-59 is complete. Read the `story-dependencies` Spec (`.rowbly/specs/story-dependencies.md` in the canonical Project) for the words and the rules.
- `factory-policy.ts` is pure. It must not read files. All facts come from `ScanInput`.
- `scan` in `src/services/factory-manager/manager-status.ts` gives the full `Story` objects of `searchStories` to `evaluateScan`. A `Story` already has `dependsOn: string[]` (ROW-59), so the manager fills `PolicyStory.dependsOn` with no new code. Examine this. The stages of `classifiedStages` are all Stages of the config, also the disabled Stages, in board order.
- Use `waitingFor` and `blocksOf` from `src/services/story-dependency/story-dependency.ts`. Do not add a second rule for Complete or Blocked. These functions take `DependencyStory` with a mandatory `dependsOn`. Map `story.dependsOn ?? []` when you call them with `PolicyStory` values.
- Put the gate in `planStory`, after `stageSkipReason` and before the check of active harness workers. Thus Backlog, Done and the other hold Stages keep their reasons, and a blocked Story with a running worker gets `skip` without a change of its attempt records.
- `limitWorkers` uses `toSorted`, which is stable. The decisions are in the order of `input.stories`. Add the downstream count as the second sort key. Calculate the indirect downstream Stories with `blocksOf` and a set of visited IDs, so that a bad cycle in the files cannot loop forever.
- `reconcileAttempt` already marks `observedStageDeparture` when the Story leaves the Stage of an attempt. Thus a Story that comes into a Stage blocked, and later becomes ready, gets `new stage stay`.
- Obey the `rowbly-code-style` skill and the STE rules.

## Assumptions

- The `start_worker` refusal uses the existing `ConflictError` path of `reserveWorkerSlot`, with the reason of the policy decision. Reason: the reservation already uses the policy decision, and the Story asks to use it. This is the smallest change.
- The `start_worker` test is in `factory-manager.test.ts`, not in `factory-policy.test.ts`. Reason: `factory-policy.test.ts` tests a pure module, and only the manager test has the faux provider and `reserveWorker`.
- The downstream count includes each direct and indirect downstream Story one time, and it does not count a complete downstream Story. Reason: the Story says "include indirect downstream Stories", and a complete Story does not wait.
- A Story that was blocked after an attempt in its current Stage stay uses the existing retry rules when it becomes ready. It gets `new stage stay` only when it has no attempt in its current stay. Reason: this keeps the attempt budget rules unchanged, and the criteria only examine a Story that comes into the Stage blocked.
- The gate comes before the check of active harness workers. Reason: the Story says "after the Stage checks and before `planAttempts`", and both orders give `skip` and do not stop the worker. The `waiting for` reason is more useful to the supervisor.
- An upstream ID of a Story that does not exist does not block. Reason: `waitingFor` of ROW-59 ignores it, and `rowbly doctor` reports it (ROW-61).
