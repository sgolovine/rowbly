---
title: Read attachment manifests in search only when the query needs them
stage: DONE
position: 32
createdAt: 2026-11-14T21:06:47.000Z
updatedAt: 2026-11-14T21:49:44.000Z
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-34
pull_request: https://github.com/sgolovine/rowbly/pull/220
---

## Goal

`searchStories` in `src/services/story/story-read.ts` reads the attachment manifest of every Story before it applies a filter. For each Story, `withAttachmentNames` does two `lstat` calls in `attachmentDir`, one `lstat` on the manifest and one manifest read.

The TUI board (`src/tui/shell/shell/use-shell-data.ts`), the factory supervisor loop (`src/services/factory-manager/supervisor-loop.ts`) and the manager status (`src/services/factory-manager/manager-status.ts`) call `searchStories({})` on each load. A search by Stage or by field also reads every manifest, also for the Stories that the filter removes.

The result: a search reads attachment data only for the Stories that it returns, and a Story with no attachment folder costs no manifest read. The board and the CLI results do not change.

## Scope

In scope:

- Apply the Stage filter and the field filters to the Stories before any attachment read.
- Read the attachment manifest only for the Stories that pass the Stage and field filters. Use the attachment names in the query match only when the query has words.
- Read the `.rowbly/attachments/` folder one time per search. Give `attachmentCount: 0` without a manifest read to each Story that has no folder in it. Keep the symlink checks of `attachmentDir` and `readAttachments` for the Stories that have a folder.
- Tests in `src/services/story/story-read.test.ts` and/or `src/services/story/story.test.ts`.

Not in scope:

- A separate list function for the board. The board shows the attachment count (`src/tui/screens/stories/story-row/story-row.tsx`), so it must read the count. `searchStories` stays the function of the board.
- A cache of attachment counts or a change to the manifest format.
- Changes to `getStory`, `countAttachments` or the CLI output.

## Acceptance criteria

- [ ] `searchStories({ stage })` and `searchStories({ fields })` do not call `readAttachments` (or read `manifest.json`) for a Story that the filter removes. A test examines this, for example with a malformed manifest on a removed Story that does not cause an error, or with a spy on the attachment module.
- [ ] `searchStories({})` does not read a manifest for a Story that has no folder in `.rowbly/attachments/`. A test examines this.
- [ ] A text search still matches attachment names (the existing test `searchStories({ query: "sample.png" })` in `src/services/attachment/attachment.test.ts` passes).
- [ ] Each Story that `searchStories` returns still has the correct `attachmentCount` (0 for a Story without attachments, N for a Story with N saved images). A test examines this.
- [ ] The order and the `position` of the returned Stories do not change (the existing `searchStories` tests pass).
- [ ] A symlink at `.rowbly/attachments/` or at the folder of a returned Story still gives a `ValidationError`, as today.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- Main file: `src/services/story/story-read.ts` (`searchStories`, `withAttachmentNames`, `matchesQuery`).
- Attachment helpers: `src/services/attachment-files/attachment-files.ts` (`attachmentDir`, `noSymlink`, `readAttachments`). A new helper that lists the Story IDs with an attachment folder can go there. It must call `noSymlink` on the root folder, and it must give an empty set when the folder does not exist (`ENOENT`).
- Keep `toStory` validation for all Story files, as today, so that an invalid Story file still fails the search.
- `positions` must still come from all Story files in board order, before the filter.
- Obey the strict code style (`.agents/skills/rowbly-code-style/SKILL.md`). The service must not import `commander`, `ink` or `react`.
- The `Story` type keeps `attachmentCount?: number`. The CLI `--json` output of `story search` keeps the `attachmentCount` key.

## Assumptions

- The board keeps `searchStories({})` and does not get a separate list function. Reason: the board shows the attachment count, and the count comes from the manifest. One readdir of the attachments folder removes the manifest reads for Stories without attachments, which is the smallest change that gives the result.
- A malformed manifest of a Story that the filter removes no longer fails the search. Reason: the search does not read that manifest. `rowbly doctor` still finds the problem.
- The returned Stories still read their manifests when they have a folder, also without query words. Reason: the result must keep `attachmentCount`.
