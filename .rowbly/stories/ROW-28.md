---
title: Stop the Specs tab from re-reading every Story for each linked Story
stage: IN_DEVELOPMENT
position: 2
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-28
pull_request: null
---

## Goal

The Specs tab of the Story Modal opens slowly when the Project has many Stories or a Story has many linked Specs.

- `listSpecs({ story })` in `src/services/spec/spec.ts` calls `getStory` only to make sure that the Story exists. `getStory` reads and parses every Story file two times (see ROW-27).
- `resolveStories` (used by `createSpec`, `updateSpec`, `linkSpec` and `unlinkSpec`) calls `getStory` one time for each linked Story, one at a time through `mapInOrder`. Each call reads the full Story folder two times again.

After this change, the spec service finds Stories from the names of the files in the Story folder. It does not read or parse Story files to make sure that a Story exists. The user gets the same results, faster.

## Scope

In scope:

- A check that a Story exists, from one listing of the Story folder (file names only, no file reads).
- `listSpecs({ story })` uses this check instead of `getStory`.
- `resolveStories` lists the Story folder one time and resolves all IDs against that list.
- Tests for the new behaviour.

Not in scope:

- Changes to `getStory` itself. ROW-27 does that work.
- Reading only the frontmatter of spec files. `listSpecs` returns the `body` of each `Spec`, and the Specs tab and `rowbly spec list --json` use it. See Assumptions.
- Changes to the TUI. `use-specs-tab.ts` keeps its call to `listSpecs`.

## Acceptance criteria

- [ ] `listSpecs({ story })` does not read any Story file. It lists the Story folder at most one time. A test examines this (for example with a spy on `readStoryFile`/`readFile` or on `listMarkdownFiles` through `vi.mock`).
- [ ] `resolveStories` lists the Story folder exactly one time for 0, 1 or many linked Story IDs, and reads no Story file. A test with three or more linked Stories examines this through `createSpec` or `updateSpec`.
- [ ] `listSpecs({ story: "ROW-09" })` for a Story that does not exist still throws `NotFoundError` with the message `Story ROW-09 not found`.
- [ ] `listSpecs({ story: "2" })`, `"row-2"` and `"ROW-02"` still give the specs of `ROW-02`.
- [ ] `createSpec` with an unknown Story still gives a `ValidationError` with the issue `{ path: ["stories"], message: "Story ROW-09 not found" }`. The issue order and the de-duplication of IDs do not change.
- [ ] A Story ID with a different project key (for example `ABC-1` in a `ROW` Project) or a value that is not an ID still gives "not found".
- [ ] All existing tests in `src/services/spec/spec.test.ts` and the Specs tab tests pass without changes to their expectations.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- `src/services/spec/spec.ts`: `lookupStory`, `resolveStories` and `listSpecs` call `getStory` today. Remove the `getStory` import.
- `src/services/story-files/story-files.ts`: add a helper that lists the Story file names of the folder and parses them, without a read of the files. Reuse `listMarkdownFiles` (from `src/services/files/files.ts`) and `parseStoryFileName`. `readStoryFiles` can use the same helper, so that the filter is in one place.
- Match a Story like `findStoryFile` in `src/services/story/story-read.ts` does: parse the input ID (`ROW-01`, `row-1` or `1`), then find a file name with `projectKey === config.projectKey` and the same `number`. Use the ID from the file name (as `StoryFile.id` does) as the resolved ID, so that the stored links do not change. `canonicalStoryId` in `spec-files.ts` already parses an ID; it can give the number.
- Do not use only `pathExists(storyPath(...))`. `parseStoryFileName` also accepts unpadded names such as `ROW-1.md`, and `storyPath` gives only the padded name `ROW-01.md`. A match on the parsed name list covers both.
- `open(ctx)` already gives `paths` and `config`. Pass them to the lookup, and do not call `findProject`/`readConfig` again.
- Keep the service rules: no `commander`, `ink` or `react`, no output. Follow `.agents/skills/rowbly-code-style/SKILL.md`. Use `.js` import extensions.
- Keep `NotFoundError` hints useful: for an ID that does not parse, give the same hint as `parseStoryId` in `story-read.ts` (`Story IDs in this project look like ROW-01.`).

## Assumptions

- The existence check uses only the file name. It does not parse or validate the Story file. Reason: the Story Modal already loaded the Story, and a link to a Story only needs the ID. `rowbly doctor` reports invalid Story files. An invalid Story file now does not make `listSpecs({ story })` fail with a `VALIDATION` error.
- Spec bodies are still read. Reason: `Spec.body` is part of the result of `listSpecs`, the Specs tab and `spec list --json` use it, and spec files are few and small. To read only the frontmatter needs a new parser path and changes the result type. That is a larger change than this Story.
- This Story does not wait for ROW-27. Reason: after this change the spec service does not call `getStory`, so the two Stories change different code and can merge in any order.
