---
title: Tell workers about the upstream Stories of their Story
stage: IN_REFINEMENT
position: 7
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-64
pull_request: null
---

## Goal

A worker knows which upstream Stories its Story depends on, and what they changed. Then it does not do their work again.

## Scope

- `runSection` in `src/services/messages/messages.ts` lists the upstream Stories of the Story: ID, title, Stage and the value of a `url` custom field such as `pull_request`, when one exists.
- Add a rule to `src/config/prompts/WORKER.md`: "The upstream Stories are complete. Their changes are on the base branch of your worktree. Do not do their work again. Read their Stories with the CLI when you need the details." Add the rule only when the Story has upstream Stories.
- A Story without dependencies gets the same message as before.

## Acceptance criteria

- [ ] The worker message of a Story with two upstream Stories lists both, with the title and the Stage.
- [ ] The worker message of a Story without dependencies does not change.
- [ ] `messages.test.ts` covers both cases.
- [ ] `docs/architecture/prompts.md` describes the new part of the message, in STE.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

Depends on ROW-59. Read the `story-dependencies` Spec.
Keep the list short: titles and IDs only, not the descriptions. The worker can read more with `rowbly story get`.
