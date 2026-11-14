---
title: Show dependencies to the supervisor and raise attention for a stuck upstream Story
stage: IN_REFINEMENT
position: 6
worktree: null
pull_request: null
---

## Goal

The supervisor knows about the dependencies. It does not try to start a blocked Story, and it tells the user when an upstream Story cannot progress.

## Scope

- `factory_snapshot` and `story_get` give `dependsOn`, `blocks` and `waitingFor` for each Story.
- `buildDigest` in `factory-manager/supervisor-loop.ts` lists the blocked Stories with their upstream IDs, in a bounded form.
- `src/config/prompts/SUPERVISOR.md` gets these rules:
  - Do not start a worker for a blocked Story. The manager refuses it.
  - Start the upstream Stories first when you must choose.
  - Do not use `hold_candidate` for a blocked Story. The policy already holds it.
- The manager raises attention when an upstream Story of a blocked Story cannot progress:
  - it is in the first Stage (Backlog),
  - the policy parked it, or
  - it is in a `hold` Stage that is not the last Stage.
- Use one attention key for each upstream Story, for example `upstream-stuck:ROW-04`. The text names the downstream Stories. The attention goes away when the upstream Story can progress.

## Acceptance criteria

- [ ] The snapshot and `story_get` give the three dependency lists.
- [ ] The digest shows `ROW-05 waits for ROW-04`.
- [ ] With ROW-04 in Backlog and ROW-05 in a work Stage, the factory raises one attention item with the key `upstream-stuck:ROW-04`. A repeat scan does not add a second item.
- [ ] When ROW-04 leaves Backlog, the attention item goes away.
- [ ] Tests use the faux provider. No test runs a real Pi model.
- [ ] `docs/architecture/prompts.md` and `docs/architecture/native-factory/README.md` describe the new rules, in STE.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

Depends on ROW-62. Read the `story-dependencies` Spec.
Prefer a deterministic attention from the manager to a prompt rule. The supervisor model must not be the only guard.
`src/services/messages/messages.ts` is the only place that builds the messages of the factory agents.
