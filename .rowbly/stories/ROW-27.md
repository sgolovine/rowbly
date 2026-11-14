---
title: Make getStory read one Story file instead of the whole folder twice
stage: IN_REFINEMENT
position: 9
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-27
pull_request: null
---

## Goal

`getStory` in `src/services/story/story-read.ts` reads and parses each Story file two times to give one Story:

1. `findStoryFile` calls `readStoryFiles` to find the file by number.
2. `getStory` calls `readStoryFiles` again for `positionIn`.

Then it reads the attachment manifest for the count. The cost increases with the size of the board, for an operation that needs one Story.

Evidence: `strace` on `rowbly story get ROW-1 --json` on a board of 26 Stories shows 52 opens of Story files.

The result for the user: `rowbly story get`, and each service that calls `getStory` (factory manager, spec, attachment, factory recovery, factory settings, `createStory` and `updateStory`), reads each Story file one time only. The output does not change.

## Scope

In scope:

- `getStory` reads the Story folder one time only, and finds the Story in that list.
- `findStoryFile` gets an optional list of Story files that the caller already has. With no list, it reads the canonical path (`storyPath`) first, and reads the folder only when that file does not exist.
- `updateStoryFields` in `src/services/story/story.ts` reads the folder one time only, and gives the list to `findStoryFile` (it calls `readStoryFiles` two times now).
- New tests in `src/services/story/story-read.test.ts`.

Not in scope:

- `searchStories`, `createStory`, `snapshotStories`, `rewriteStories` and the doctor checks.
- The second read in `updateOrRestore` (the `getStory` after the write). It must read the new data.
- A change to the attachment count (`countAttachments`). It reads the attachment manifest, not the Story files.
- A cache of Story files between calls.

## Acceptance criteria

- [ ] A test that spies on `readFile` of `node:fs/promises` (the same pattern as `src/services/conversation/conversation.test.ts`) shows that `getStory` opens each Story file of a board with 3 or more Stories at most one time.
- [ ] `getStory` gives the same `position` and `attachmentCount` as before. The existing `getStory` and `updateStory` tests in `src/services/story/story.test.ts` pass with no change.
- [ ] A test of `getStory` covers a Story with no `position` in its frontmatter: it comes after the Stories of its Stage that have a `position`, and before Stories with no `position` and a larger number.
- [ ] A test of `getStory` covers a Story in a Stage that is not in the config: `getStory` throws `ValidationError` with the `rowbly doctor` hint, as now.
- [ ] A test shows that `findStoryFile` with no list finds a Story file with a non-canonical name (for example `ROW-1.md`), and throws `NotFoundError` for an unknown number.
- [ ] A test shows that `findStoryFile` with a list does not read the folder or a file.
- [ ] `updateStory` without a position and without a change of Stage opens each Story file at most one time before the write (a test with the same `readFile` spy).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- Files: `src/services/story/story-read.ts`, `src/services/story/story.ts`, new `src/services/story/story-read.test.ts`.
- Helpers in `src/services/story-files/story-files.ts`: `storyPath(paths, projectKey, number)` gives `<KEY>-<NN>.md` (2 digits minimum). `readStoryFile(paths, fileName)` reads and parses one file. `readStoryFiles(paths)` reads all files and sorts them by number.
- `parseStoryFileName` accepts names such as `ROW-1.md` and `ROW-001.md`. The doctor reports them, but `findStoryFile` must continue to find them. Thus a missing canonical file (`ENOENT`) falls back to the folder list, with the existing match (`projectKey` and `number`, first match in number order).
- Proposed shape: `findStoryFile(paths, config, id, files?)`. With `files`, search only that list. `getStory` calls `readStoryFiles` one time, then `findStoryFile(paths, config, input.id, files)`, then `positionIn(files, file)`.
- `positionIn` needs the frontmatter of all Stories in the same Stage, so `getStory` must read the folder. A read of only the one file does not give the position.
- Keep `getStory` exported from `story.ts`, and keep the signatures of `getStory`, `positionIn`, `toStory` and `countAttachments`.
- Follow `.agents/skills/rowbly-code-style/SKILL.md`. Services do not print or exit. Use `.js` extensions in relative imports.

## Assumptions

- `getStory` reads the folder one time and does not first read the file by path. Reason: `getStory` always gives the position, and the position needs all Stories of the Stage. A read by path first adds one open of the same file, which breaks "at most one time".
- The direct read by `storyPath` applies only to `findStoryFile` with no list (for example `deleteStory`). Reason: the author asked for a read by path, and this is the only path where the position is not necessary.
- A missing canonical file falls back to a folder scan. Reason: the current code finds non-canonical names such as `ROW-1.md`, and the change must not remove that behaviour.
- The new tests go in a new `story-read.test.ts`. Reason: the author asked for "the tests of `story-read`", and AGENTS.md puts each test next to its file. The existing `getStory` tests stay in `story.test.ts`.
- `updateStoryFields` is in scope. Reason: it is a caller that already has the list ("let callers that already have the list pass it in"), and the change is small.
