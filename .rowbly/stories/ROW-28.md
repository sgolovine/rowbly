---
title: Stop the Specs tab from re-reading every Story for each linked Story
stage: BACKLOG
position: 2
worktree: null
pull_request: null
---

## Problem

The Specs tab of the Story Modal calls `listSpecs({ story })` in `src/services/spec/spec.ts`. That calls `getStory`, which reads every Story file two times (see ROW-27). It then reads every spec file.

`resolveStories` calls `getStory` for each linked Story, one at a time through `mapInOrder`. Each call reads the full Story folder two times again. A Story that many specs link to opens slowly.

## Proposed fix

- Check that a Story exists with one read of the folder, or with `pathExists` on its path, not with `getStory`.
- In `resolveStories`, read the Story folder one time and resolve all IDs against that list.
- Do not read a spec file body when only the frontmatter links are necessary for the filter.

## Acceptance

- Opening the Specs tab reads each Story file at most one time.
- `resolveStories` reads the Story folder one time for any count of linked Stories.
- The existing spec tests pass, including the `Story ... not found` issue.
