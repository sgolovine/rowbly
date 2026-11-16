---
title: Tell workers about the upstream Stories of their Story
stage: DONE
position: 48
uid: 59dc4753-eefa-452e-b0bb-6a183a0ff5ea
createdAt: 2026-11-14T23:26:46.000Z
updatedAt: 2026-11-14T23:59:44.000Z
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-64
pull_request: https://github.com/sgolovine/rowbly/pull/236
---

## Goal

A worker knows which upstream Stories its Story depends on, and what they changed. Then it does not do their work again. This Story is part of the `story-dependencies` Spec.

## Scope

In scope:

- The `Run` section of the worker message (`runSection` in `src/services/messages/messages.ts`) lists the upstream Stories of the Story, in the order of `dependsOn`. Each line gives the ID, the title, the Stage key and the value of each `url` custom field that has a value (for example `pull_request`).
- A rule in `src/config/prompts/WORKER.md`, between new `<!-- upstream -->` and `<!-- /upstream -->` markers: "The upstream Stories are complete. Their changes are on the base branch of your worktree. Do not do their work again. Read their Stories with the CLI when you need the details." The message keeps this rule only when the Story has upstream Stories, with the same mechanism as the `<!-- checks -->` block.
- `buildWorkerPrompt` in `src/services/factory-manager/worker-launch.ts` gives the upstream Stories to `workerMessage`.
- Docs: the `## The messages` section of `docs/architecture/prompts.md`.

Not in scope:

- The descriptions of the upstream Stories. The worker reads them with `rowbly story get`.
- The supervisor digest (ROW-63), the policy gate (ROW-62), the TUI (ROW-65).
- Downstream Stories (`blocks`) in the worker message.

## Acceptance criteria

- [ ] The worker message of a Story with two upstream Stories lists both in the `Run` section, in `dependsOn` order, with the ID, the title and the Stage key. A `url` custom field with a value shows on the line of its Story. A `url` field with no value and a field of a different type do not show.
- [ ] The worker message of a Story with upstream Stories contains the upstream rule of `WORKER.md`, without the marker comments.
- [ ] The worker message of a Story without dependencies is the same as before this change: no upstream lines in `Run`, no upstream rule and no marker comments.
- [ ] An ID in `dependsOn` of a Story that does not exist gives no line and no error.
- [ ] `src/services/messages/messages.test.ts` covers each criterion above.
- [ ] `docs/architecture/prompts.md` describes the upstream lines and the conditional rule, in STE.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- ROW-59 is complete. `Story.dependsOn: string[]` exists (`src/services/story/story-types.ts`). Read the `story-dependencies` Spec (`.rowbly/specs/story-dependencies.md` in the canonical Project).
- `messages.ts` is the only module that builds agent messages. Keep all text of the message there.
- Add `upstream?: readonly RunUpstream[]` to `WorkerRun`, with `RunUpstream = { id, title, stage, links: readonly { key: string; value: string }[] }`. With no upstream Stories, `runSection` gives the same text as now. Suggested line format: `- ROW-59: Store Story dependencies in the Story service (DONE), pull_request: https://…`, under a heading line such as `Upstream Stories (read each one with \`story get\`):`.
- Add a pure function in `messages.ts`, for example `upstreamOf(story, stories, urlFieldKeys)`, that maps `story.dependsOn` to `RunUpstream[]` and skips unknown IDs. Test it in `messages.test.ts`. Then `worker-launch.ts` only reads data and calls it.
- In `buildWorkerPrompt`, read the Stories one time with `searchStories({}, manager.ctx)` only when `story.dependsOn` is not empty. Get the `url` field keys from `readConfig(manager.paths)` (`customFields` with `type: "url"`). Do not load Pi or other modules outside the service layer.
- Generalize `workerSystemPrompt(text, hasChecks)` so that it handles the `checks` block and the `upstream` block, for example `workerSystemPrompt(text, { checks: boolean, upstream: boolean })`. Update the callers and the existing tests.
- Obey the `rowbly-code-style` skill and the STE rules.

## Assumptions

- The rule text says that the upstream Stories are complete, and the list still shows the Stage of each one. Reason: the policy gate (ROW-62) starts a worker only when all upstream Stories are complete, but a worker can start before ROW-62 is merged, or continue after an upstream Story goes back. The Stage lets the worker see this.
- The rule goes in `WORKER.md` inside markers, and `messages.ts` removes it for a Story without dependencies. Reason: `WORKER.md` is static, and the `<!-- checks -->` block already uses this mechanism.
- The list shows the Stage key, not the label. Reason: the `Run` section already gives the Stage as a key.
- The list shows the value of each `url` custom field, not only `pull_request`. Reason: the Story says "a `url` custom field such as `pull_request`", and field keys differ in each Project.
- An unknown upstream ID is skipped without a warning. Reason: `waitingFor` of ROW-59 ignores it, and `rowbly doctor` reports it (ROW-61).
- The test is in `messages.test.ts` only, with no new test in `factory-manager.test.ts`. Reason: the Story names `messages.test.ts`, and `worker-launch.ts` only reads data and calls the tested pure function.
