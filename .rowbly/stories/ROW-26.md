---
title: Add `createdAt` and `updatedAt` frontmatter.
stage: BACKLOG
position: 1
worktree: null
pull_request: null
---

Add two optional fields to frontmatter:

- `createdAt`: When story was created
- `updatedAt`: Last time the story was updated

---

- Any time a story is created, we log the `createdAt` time. UTC, updated for the users current timezone (edit this in settings)
- Any time the story is updated for any reason (literally any event where a change was made to the story post creation), we update the `updatedAt` time.
