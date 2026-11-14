---
title: Set and show Story dependencies in the CLI
stage: CHANGELOG
position: 1
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-60
pull_request: https://github.com/sgolovine/rowbly/pull/234
---

## Goal

Users and agents can set and see the dependencies of a Story with the CLI. The words (Upstream Story, Downstream Story, Blocked, Ready, Complete) and the rules are in the `story-dependencies` Spec.

## Scope

In scope:

- `rowbly story create --depends-on <ids>` and `rowbly story update <id> --depends-on <ids>`. The value is a comma-separated list, and the flag is repeatable. On update, the list replaces the old list. `--depends-on ""` removes all dependencies.
- `rowbly story update <id> --add-dependency <id>` and `--remove-dependency <id>` change one item. Both are repeatable.
- `rowbly story get <id>` shows `Depends on`, `Blocks` and `Blocked` (yes or no, with the upstream IDs that are not complete). `--json` adds `dependsOn`, `blocks` and `waitingFor`.
- `rowbly story search --blocked` and `--ready` filter the Stories. They are mutually exclusive.
- A validation error from the service gives a non-zero exit code, with the `details` of the service in the JSON error (see Assumptions about the exit code).
- Update `skills/rowbly-reference.md`, then copy it to each `skills/<name>/references/rowbly-reference.md`.
- Update `docs/architecture/cli.md`.

Not in scope:

- The storage, the validation and the pure dependency functions. ROW-59 adds them.
- The factory gate, the launch order and the TUI. Other Stories of the Spec do this work.
- A change of the exit code of other commands.

## Acceptance criteria

- [ ] `rowbly story create --title X --depends-on ROW-01,ROW-02` saves both IDs in this order. A command test examines the file or `getStory`.
- [ ] `--depends-on ROW-01 --depends-on ROW-02` gives the same result as `--depends-on ROW-01,ROW-02`. Spaces around a comma are ignored.
- [ ] `--add-dependency` and `--remove-dependency` change only the given ID. Both are repeatable. An add of an ID that is in the list, or a remove of an ID that is not in the list, changes nothing and is not an error.
- [ ] `--depends-on` together with `--add-dependency` or `--remove-dependency` gives a Commander error and exit 1.
- [ ] `--depends-on ""` removes the `dependsOn` key from the file.
- [ ] A cycle gives exit 1, and the JSON error has `code`, `message` and `details.cycle` with the IDs of the cycle. An unknown ID gives exit 1 and `details.unknown`. No file changes.
- [ ] `story get --json` gives `dependsOn`, `blocks` and `waitingFor` (arrays of Story IDs). The text output has the lines `Depends on: …`, `Blocks: …` and `Blocked: yes (<IDs>)` or `Blocked: no`. An empty list shows `none`.
- [ ] `story search --blocked` gives only blocked Stories, and `--ready` only ready Stories. `--blocked --ready` gives a Commander error and exit 1. Both flags work together with the query, `--stage` and `--field`.
- [ ] Each copy of `rowbly-reference.md` is the same as `skills/rowbly-reference.md` (`cmp` gives no difference).
- [ ] `docs/architecture/cli.md` describes the new flags, in STE.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- Depends on ROW-59. Read the `story-dependencies` Spec and the description of ROW-59. Start the development only after the ROW-59 code is on the main branch. Rebase the branch on it before you start. Until ROW-59 is complete, the factory has no dependency gate, so examine this yourself.
- ROW-59 gives: `dependsOn` on `Story`, `CreateStoryInput` and `UpdateStoryInput`; validation with `ValidationError` and `details` (`unknown`, `cycle`, …) in `createStory` and `updateStory`; and the pure functions `blocksOf`, `waitingFor` and `isBlocked` in `src/services/story-dependency/story-dependency.ts`.
- Keep the command thin (`src/commands/story/story.ts`). It calls only the functions of `src/services/story/` and `src/services/story-dependency/`. Put all logic in the services:
  - Add `addDependsOn?: readonly string[]` and `removeDependsOn?: readonly string[]` to `UpdateStoryInput`. `updateStory` applies them to the current list under the Project write lock, then validates the result as for `dependsOn`. A service call with `dependsOn` and one of these keys gives a `ValidationError`.
  - `getStory` (or a new service function that `story get` calls) gives `blocks` and `waitingFor` together with the Story. Calculate them with the ROW-59 functions from one read of all Stories.
  - Add a filter to `SearchStoriesInput` in `src/services/story/story-read.ts`, for example `dependency?: "blocked" | "ready"`. The filter uses `isBlocked`.
  - Update the service tests next to each changed service (`story.test.ts`, `story-read.test.ts`).
- Parse `--depends-on` in `src/commands/output/output.ts` or in the command with `collect`, then split each value on `,`, trim each item and remove empty items. `--depends-on ""` gives `[]`.
- Use Commander `.conflicts()` for `--blocked`/`--ready` and for `--depends-on` against `--add-dependency`/`--remove-dependency`.
- Errors go through `run()` in `src/commands/output/output.ts`. It already prints `{ "error": { code, message, hint, details } }` with `--json`.
- Add command tests in `src/commands/story/story.test.ts` with `runCli` and `useTestProject`.
- The TUI must not change. `story get` text output is the CLI only.

## Assumptions

- A validation error gives exit 1, not exit 2. Reason: `run()` in `src/commands/output/output.ts` gives exit 1 for each `RowblyError`, and `docs/architecture/cli.md` documents this contract. An exit 2 only for this error makes the CLI inconsistent, and a change for all commands is larger than this Story. The JSON `details` give the cause.
- `--add-dependency` and `--remove-dependency` are input keys of `updateStory`, not a read-then-write in the command. Reason: the change must occur under the Project write lock, and logic must not be in a command.
- An add of an existing ID and a remove of a missing ID are not errors. Reason: the Spec removes duplicates without an error, and the result is the state that the user asked for.
- `--depends-on` cannot be used with `--add-dependency` or `--remove-dependency`. Reason: the result of the combination is not clear, and a refusal is the smallest scope.
- When `--remove-dependency` removes the last ID, the `dependsOn` key is removed. Reason: the Spec says that a Story without dependencies has no `dependsOn` key.
- The text output of `story search` does not change. Reason: the Story does not ask for it.
