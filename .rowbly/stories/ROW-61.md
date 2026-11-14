---
title: Check Story dependencies in rowbly doctor
stage: IN_REFINEMENT
position: 4
worktree: null
pull_request: null
---

## Goal

`rowbly doctor` finds bad dependencies after a git merge or a hand edit, and `--fix` repairs the safe cases.

## Scope

Add `src/services/doctor/story-dependency-checks.ts`. It reports these problems:

| Problem                                         | Severity | `--fix`                         |
| ----------------------------------------------- | -------- | ------------------------------- |
| `dependsOn` is not a list of strings            | error    | none                            |
| An ID that is not a Story of the Project        | error    | Remove the ID                   |
| The Story depends on itself                     | error    | Remove the ID                   |
| The same ID two times                           | warning  | Remove the duplicate            |
| A cycle                                         | error    | none; the message names the cycle |
| An empty `dependsOn` list                       | warning  | Remove the key                  |

- Report a cycle one time, not one time for each Story in it.
- A cycle has no automatic fix, because only a person can choose the relation to remove. The message tells the user to run `rowbly story update <id> --remove-dependency <id>`.

## Acceptance criteria

- [ ] Each problem in the table gives the given severity and message.
- [ ] `--fix` repairs each problem that has a fix, and the second run of `rowbly doctor` is clean.
- [ ] A cycle of three Stories gives one error.
- [ ] `doctor.test.ts` or a new test file covers each row of the table.
- [ ] `docs/architecture/storage.md` lists the new checks, in STE.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

Depends on ROW-59. Read the `story-dependencies` Spec.
Use `findCycle` from `src/services/story-dependency/`. Do not write a second cycle search.
Follow the pattern of `story-field-checks.ts` and `spec-link-checks.ts`.
