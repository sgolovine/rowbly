---
title: Show dependencies to the supervisor and raise attention for a stuck upstream Story
stage: DONE
position: 49
uid: 7db47e39-9fe5-4d44-a6be-a41530e98f60
createdAt: 2026-11-14T23:26:45.000Z
updatedAt: 2026-11-15T00:04:34.000Z
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-63
pull_request: https://github.com/sgolovine/rowbly/pull/237
---

## Goal

The supervisor knows about the dependencies. It does not try to start a blocked Story, and it tells the user when an upstream Story cannot progress. This Story is part of the `story-dependencies` Spec.

## Scope

In scope:

- `factory_snapshot` and `story_get` give `dependsOn`, `blocks` and `waitingFor` for each Story.
- `buildDigest` in `src/services/factory-manager/supervisor-loop.ts` lists the blocked Stories with their upstream IDs, in a bounded form.
- `src/config/prompts/SUPERVISOR.md` gets these rules:
  - Do not start a worker for a blocked Story. The manager refuses it.
  - Start the upstream Stories first when you must choose.
  - Do not use `hold_candidate` for a blocked Story. The policy already holds it.
- The manager raises attention when an upstream Story of a blocked Story cannot progress:
  - it is in the first Stage of the board (Backlog),
  - the policy parked it (it has an entry in `state.parked`), or
  - it is in a Stage with the prompt class `hold` that is not the last Stage.
- Use one attention key for each upstream Story, for example `upstream-stuck:ROW-04`. The text names the downstream Stories. The attention goes away when the upstream Story can progress.
- Docs: `docs/architecture/prompts.md` and `docs/architecture/native-factory/README.md` (and `recovery.md` if it lists the manager attention keys).

Not in scope:

- The policy gate, the `waiting for` skip reason, the launch order and the `start_worker` refusal (ROW-62).
- The upstream Stories in the worker message (ROW-64).
- The TUI (ROW-65).
- The automatic move of a stuck upstream Story (ROW-66).
- The CLI flags for dependencies (ROW-60) and the `doctor` checks (ROW-61).
- A memory of dismissed `upstream-stuck:` entries. See Assumptions.

## Acceptance criteria

- [ ] Each decision in the `factory_snapshot` result has `dependsOn`, `blocks` and `waitingFor` arrays for its Story. A test examines them for the Spec example (ROW-05 depends on ROW-04).
- [ ] The `story_get` result has `dependsOn`, `blocks` and `waitingFor`. The three lists are before `description` in the JSON text, so that the 8192-character limit does not cut them. A test examines them.
- [ ] The digest has a `blocked` section with the item `ROW-05 waits for ROW-04` when ROW-04 is not complete. A Story with more upstream Stories gives `ROW-03 waits for ROW-01, ROW-02`. The section has a maximum of 12 items (the existing digest paging). A test examines it.
- [ ] The `blocked` section alone does not make the digest `material`. A test examines that a digest with only blocked Stories does not wake the supervisor.
- [ ] With ROW-04 in Backlog and ROW-05 in a work Stage, a pass of the supervisor loop raises one attention entry with the key `upstream-stuck:ROW-04`, the `storyId` `ROW-04`, and a text that contains `ROW-05`. A second pass does not add a second entry.
- [ ] When ROW-04 moves to a work Stage, the next pass removes the `upstream-stuck:ROW-04` entry.
- [ ] A parked upstream Story and an upstream Story in a `hold` Stage that is not the last Stage also give the entry. An upstream Story in the last Stage gives no entry, because the downstream Story is not blocked.
- [ ] A blocked downstream Story in a Stage that is not a `work` Stage (for example Backlog) gives no entry.
- [ ] `src/config/prompts/SUPERVISOR.md` has the three new rules. A prompt test or a message test finds them.
- [ ] Tests use the faux provider. No test runs a real Pi model.
- [ ] `docs/architecture/prompts.md` and `docs/architecture/native-factory/README.md` describe the new rules, in STE.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- Depends on ROW-62. Read the `story-dependencies` Spec (`.rowbly/specs/story-dependencies.md`). ROW-59 (the `dependsOn` field and `src/services/story-dependency/story-dependency.ts`) is on the main branch. If ROW-62 is not merged when the work starts, start the branch from the ROW-62 branch or wait for the merge.
- Use the existing helpers in `src/services/story-dependency/story-dependency.ts`: `blocksOf`, `waitingFor`, `isBlocked`, `isComplete`. `Story` from `searchStories` and `getStory` already has `dependsOn`.
- Snapshot: `buildSnapshot` in `src/services/factory-manager/manager-status.ts`. Add the three lists to each decision of the page, from one `searchStories` call and `listStages`.
- `story_get`: `readTools` in `src/services/factory-manager/supervisor-tools.ts`. Build the object as `{ id, title, stage, dependsOn, blocks, waitingFor, ...rest }` before `JSON.stringify(...).slice(0, 8192)`.
- Digest: `buildDigest` in `supervisor-loop.ts` already reads all Stories and the classified Stages. Add `blocked: string[]` to the `supervisorDigest` input. Only Stories in a `work` Stage go in the list. Do not add it to `material`.
- Attention: put the pure rule in a new module, for example `src/services/factory-manager/upstream-attention.ts`, with a test next to it. Input: the Stories, the classified Stages (`classifiedStages`) and `state.parked` from `readFactoryState`. Output: a map of `upstream-stuck:<id>` to `{ text, storyId }`. Call it from `superviseOnce` after `reconcilePolicy`. In one `setState`, remove each existing `upstream-stuck:` entry that is not in the new map, and set the new entries with `withEntry`/`withoutEntry` from `src/services/store/store.ts`. The manager entries do not use the 100-entry limit of `raise_attention`.
- Example text: `ROW-04 cannot progress (in Backlog). ROW-05 waits for it.` Use `parked` or `in hold Stage <label>` for the other reasons. Keep the text to 500 characters.
- The manager rule is the guard. The supervisor prompt rules only help the model. The supervisor model must not be the only guard.
- `src/services/messages/messages.ts` is the only place that builds the messages of the factory agents. The digest text goes through `supervisorMessage`. Do not build a message in a different module.
- Keep the Pi SDK behind `src/services/pi-runtime/`. Tests use the faux provider and `useTestProject`.

## Assumptions

- The snapshot gives the three lists on each decision of the page, and not as a separate list of all Stories. Reason: the snapshot is already paged by decision, and this keeps it bounded.
- The digest `blocked` section uses text items `<id> waits for <ids>` and contains only blocked Stories in a `work` Stage. Reason: the acceptance criterion of the author uses this text, and only a `work` Stage can get a worker.
- The `blocked` section does not make the digest material. Reason: a blocked Story needs no action from the supervisor, and a wake on each scan would waste supervisor turns.
- Only a blocked downstream Story in a `work` Stage causes an `upstream-stuck:` entry. Reason: the acceptance criterion of the author puts ROW-05 in a work Stage, and a downstream Story in Backlog or a hold Stage does not wait for a worker.
- "First Stage" is the first Stage of the board order (`stages[0]`), also if it is disabled. A disabled Stage and a Story that the supervisor holds with `hold_candidate` do not cause an entry. Reason: smallest scope that agrees with the list of the author. A supervisor hold ends in 30 minutes.
- When the user dismisses an `upstream-stuck:` entry and the upstream Story is still stuck, the next pass adds the entry again. Reason: the problem still applies, and a memory of dismissed entries is more scope. A person can change this later.
- When an upstream Story is stuck for more than one reason, the text gives the first reason in this order: first Stage, parked, hold Stage. Reason: one entry for each upstream Story.
