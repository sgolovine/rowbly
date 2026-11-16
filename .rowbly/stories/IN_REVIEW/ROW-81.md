---
title: Re-number a Story automatically when two Story files have the same ID
stage: IN_REVIEW
position: 80
createdAt: 2026-11-16T19:31:02.777Z
updatedAt: 2026-11-16T21:38:30.231Z
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-81
pull_request: https://github.com/sgolovine/rowbly/pull/267
---

## Goal

Two Story files can get the same Story ID. For example, an older `rowbly` build reads only the flat `stories/` folder, so it does not see a Story in a Stage folder and gives out its number again. A Git merge of two branches can also cause this.

On 2026-11-16, `stories/BACKLOG/ROW-77.md` ("Add support for story tags") and `stories/IN_DEVELOPMENT/ROW-77.md` ("Expand and collapse the Story sidebar") had the same ID. The TUI keeps the selection by Story ID, so the cursor could not go to the second `ROW-77`. It always went back to the first. Today `rowbly doctor` only reports the error ("Story ID ROW-77 is also used by …"), and `--fix` does nothing.

Result: Rowbly finds a duplicate Story ID and gives the newer Story the next free number. The older Story keeps its ID. The TUI then shows the two Stories with different IDs, and the user can select each of them. Rowbly tells the user about each change.

## Scope

In scope:

- A new service that finds the duplicates and re-numbers them. A duplicate is two or more Story files of the Project key with the same number, in one folder or in different folders (the flat `stories/` folder and the Stage folders). `ROW-7.md` and `ROW-07.md` are duplicates.
- The rule that selects the Story that keeps the ID, and the Story that gets a new number (see Technical notes).
- The re-number: the next free number of the Project, and the move of the file to `stories/<stage key>/<projectKey>-<n>.md`.
- The repair runs in `rowbly doctor --fix`, and in the TUI each time that the board loads or reloads (also after a file change that the TUI file watch finds).
- A TUI notice and a `doctor` line for each change, for example `ROW-77 → ROW-79: duplicate ID`.
- Update `docs/architecture/storage.md` (the Story folder doctor table) and the other docs that describe the duplicate check or the board load.

Not in scope:

- A change to the older builds of `rowbly`.
- A repair in `searchStories`, in a CLI command other than `rowbly doctor --fix`, or in the factory daemon.
- A move of references (other `dependsOn` lists, Spec links, the attachment folder, Threads, factory attempts, worktrees, branches) to the new ID. All references stay with the ID, thus with the Story that keeps the ID. See Assumptions.
- A change of the TUI selection logic for two Stories with the same ID. When Rowbly cannot repair a duplicate, the old behaviour stays.
- A new CLI command to re-number a Story manually.

## Acceptance criteria

- [ ] A service test: two files `stories/BACKLOG/ROW-77.md` (`createdAt` 2026-01-01) and `stories/IN_DEVELOPMENT/ROW-77.md` (`createdAt` 2026-02-01), with highest Project number 78, give `ROW-79` to the `IN_DEVELOPMENT` Story. Its file is `stories/IN_DEVELOPMENT/ROW-79.md`, and its title, body, stage, position and custom fields do not change. The `BACKLOG` file does not change.
- [ ] A service test: a Story without `createdAt` is older than a Story with `createdAt`. If the two Stories have no `createdAt` or the same `createdAt`, the fallback rule of Technical notes selects the newer Story.
- [ ] A service test: three files with the same number give two new numbers in sequence (for example 79 and 80). The oldest Story keeps the ID.
- [ ] A service test: `ROW-7.md` and `ROW-07.md` are duplicates, and the repair writes the new file with the canonical name.
- [ ] A service test: if the newer Story has factory state and the older Story does not, the older Story gets the new number. If the two Stories have factory state, no file changes and the result reports the duplicate as not repaired.
- [ ] A service test: `dependsOn` lists of other Stories, Spec links and the attachment folder `attachments/ROW-77/` do not change.
- [ ] A service test: if the old file changed or disappeared after the plan (as with a second process), or if the target file exists, the repair does not delete or overwrite a file. It does not create a second copy of the Story.
- [ ] A service test: a Project with no duplicates gives an empty result and changes no file.
- [ ] `rowbly doctor --fix` re-numbers the duplicate and its output has a fixed issue with the text `ROW-77 → ROW-79: duplicate ID` (or the same information). `rowbly doctor` without `--fix` reports the error with this fix as the available fix, and changes no file. A doctor test examines both.
- [ ] When the repair cannot run (the two Stories have factory state), `rowbly doctor` reports the existing error with no fix.
- [ ] Only a person can examine this criterion: in the TUI, after a repair on the board load or after a file change, the board shows the new ID, an info toast shows `ROW-77 → ROW-79: duplicate ID`, and the user can select each of the two Stories.
- [ ] `docs/architecture/storage.md` shows the new `--fix` action in the doctor table, the selection rule and the factory state rule.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

Existing code:

- `src/services/doctor/story-checks.ts`: `repeatedNumbers()` finds the duplicates, and `storyNameIssues()` writes the error `Story ID … is also used by …`. `locationIssues()` does not move a repeated file.
- `src/services/story-files/story-files.ts` and `story-folders.ts`: `listStoryEntries`, `parseStoryFileName`, `formatStoryId`, `storyPath`, `storyHomePath`, `readStoryFile`, `writeStoryFile`, `storyTimeOf`.
- `src/services/story/story.ts` `createStory()`: the next free number is `Math.max(0, ...numbers) + 1` of all Story files. Use the same rule.
- `src/services/project/project.ts` `renameStoryKey()`: an example of a rename of Story files.
- `src/services/factory-state/state-file.ts`: the attempts of `.rowbly/state.json` (`story`, `stage`, `status`).
- `src/tui/shell/shell/use-shell-data.ts` `loadBoard()`: the board load. `useStoryChanges` calls `data.refresh` after a file change. `useToast()` in `src/tui/hooks/toasts.ts` shows the notice.

New service (suggested name `src/services/story-renumber/story-renumber.ts`, with a test next to it):

- `findDuplicateStoryIds(ctx)` gives the plan, and `repairDuplicateStoryIds(ctx)` applies it. The result is a list of `{ from, to, path }` changes and a list of duplicates that were not repaired, with the reason. The service does not print.
- Selection of the Story that keeps the ID, in this order:
  1. The Story with the earliest valid `createdAt`. A Story with no valid `createdAt` is older than a Story with one.
  2. If equal: the file with the earlier modification time (`mtimeMs`).
  3. If equal: the path that comes first in string order.
- Factory state of one Story file: a non-empty `worktree` or `pull_request` frontmatter value, or an attempt in `.rowbly/state.json` with the same ID and the stage of that file. Read `state.json` without the state lock. A missing or invalid state file means no attempts.
  - If only the Story that keeps the ID has factory state, or no Story has factory state: use the selection rule.
  - If a Story that the rule selects for a new number has factory state, give the new number to a Story of the group that has no factory state.
  - If more than one Story of the group has factory state: do not repair the group. Report it.
- Re-number, for each Story that gets a new number:
  1. Read the old file and keep its bytes.
  2. Take the next free number again from the current list of Story files.
  3. Write the new file at `storyPath(paths, projectKey, n, stage)` with an exclusive create (flag `wx`). Set `updatedAt` to the time of the service (`ctx.now`). Keep all other frontmatter.
  4. Read the old file again. If its bytes are different or it is gone, remove the new file and stop for this Story. Else remove the old file.
  5. If the exclusive create fails with `EEXIST`, take the next number one time. Then report the Story as not repaired.
- Locks: the service takes no lock. `rowbly doctor --fix` can run under the external `flock` of the factory command prefix, and a second `flock` on the same file in the same process tree would wait for itself. The steps above make the repair safe when two processes run it at the same time. The service never takes the state lock.
- `rowbly doctor`: in `checkStories`, when `run.fix` is true, apply the repair before the list of entries, and add one fixed issue for each change. Without `--fix`, add the fix text to the error of the duplicate when a repair is possible. Use `runNow(run)` for the time.
- TUI: in `loadBoard()`, call `repairDuplicateStoryIds` before `searchStories`. Give the changes to the shell, and show one info toast for each change. A failure of the repair shows an error toast and the board still loads. The repair changes files, the file watch reloads the board one more time, and the second repair finds nothing. Do not write a TUI test.
- The board, help, doctor, status and history paths must not load Pi. The new service must not import `src/services/pi-runtime/`.
- Read `.agents/skills/rowbly-code-style/SKILL.md` and `.agents/skills/rowbly-tui-design/SKILL.md` before the change.

## Assumptions

- All references to the duplicate ID stay with the Story that keeps the ID: `dependsOn` of other Stories, Spec links, `attachments/<ID>/`, Threads, `state.json` attempts, worktrees and branches. Reason: Rowbly cannot know to which of the two Stories a reference belongs. This is the smallest scope, and the Story that keeps the ID is the original owner of the ID in most cases. The notice tells the user about the change, and the user can correct a reference.
- A Story with no valid `createdAt` is older than a Story with `createdAt`, then the file modification time decides, then the path. Reason: only older builds write no `createdAt`, so that Story was created first. The modification time is a weak fallback after a Git checkout, so a path order makes the result fixed.
- Factory state is a non-empty `worktree` or `pull_request` frontmatter value, or a `state.json` attempt with the same ID and Stage. If more than one Story of the group has factory state, Rowbly only reports the problem. Reason: the author wants a Story that the factory works on to keep its ID. These are the values that the factory and the worktree service read from a Story. Threads are not examined separately, because the factory records each worker in an attempt.
- The repair runs only in `rowbly doctor --fix` and in the TUI board load. It does not run in `searchStories`, in other CLI commands or in the factory daemon. Reason: the author named only these two places. A repair in each read would change files during a factory run without a person who sees the notice.
- The repair takes no Project write lock. It uses an exclusive create and a check of the old bytes. Reason: the factory runs `rowbly doctor --fix` under an external `flock` on the Project write lock, so a second lock in the service would wait for itself. The TUI also writes Story files without the lock today.
- The doctor and TUI notice text is `ROW-77 → ROW-79: duplicate ID`. Reason: the author gave this example.
