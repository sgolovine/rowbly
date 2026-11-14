---
title: Hold blocked Stories in the factory policy and start upstream Stories first
stage: IN_REFINEMENT
position: 5
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-62
pull_request: null
---

## Goal

The factory does not start a worker for a blocked Story. When the worker limit applies, it starts the upstream Stories first.

## Scope

- Add `dependsOn?: string[]` to `PolicyStory` in `src/services/factory-policy/policy-types.ts`. The manager fills it when it builds the scan input.
- In `planStory` (`factory-policy.ts`), after the Stage checks and before `planAttempts`, skip a blocked Story with the reason `waiting for ROW-01, ROW-02`. Add `waitingFor: string[]` to `PolicyDecision`.
- A blocked Story records no attempt and uses no attempt budget. The policy never parks a Story because it is blocked.
- A Story that becomes ready gets the decision `start` with the reason `new stage stay` on the next scan, as a Story that comes into the Stage.
- `limitWorkers` sorts the launches by: the Stage nearest to the last Stage, then the number of blocked downstream Stories (more first, include indirect downstream Stories), then the order of the board.
- `start_worker` refuses a blocked Story with a clear error that lists the upstream IDs. Find the eligibility check in `src/services/factory-manager/` and use the policy decision.
- A worker that runs when its Story becomes blocked again continues. Do not stop it.

## Acceptance criteria

- [ ] With the five Stories of the example in the Spec in a work Stage, the first scan starts workers only for 01, 02 and 04.
- [ ] When 01 and 02 reach the last Stage, the next scan starts 03. When 04 reaches the last Stage, the next scan starts 05.
- [ ] With a worker limit of 1, and an upstream Story and an unrelated Story in the same Stage, the upstream Story starts first.
- [ ] A blocked Story is never parked, and its attempt count stays 0.
- [ ] `start_worker` for a blocked Story gives an error and starts nothing.
- [ ] `factory-policy.test.ts` covers each criterion above. The tests use the faux provider where a session is necessary.
- [ ] `docs/architecture/native-factory/README.md` (Policy) describes the gate and the order, in STE.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

Depends on ROW-59. Read the `story-dependencies` Spec.
`factory-policy.ts` is pure. Give it the facts in `ScanInput`; it must not read files.
Use `waitingFor` and `blocksOf` from `src/services/story-dependency/`, so that the policy and the CLI use the same rule.
The check queue (`check-queue/check-order.ts`) uses the same Stage order. Do not change the check queue in this Story.
