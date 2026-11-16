---
title: Organize story by stage within `stories` folder.
stage: BACKLOG
createdAt: 2026-11-16T16:07:13.306Z
updatedAt: 2026-11-16T16:07:13.306Z
worktree: null
pull_request: null
---

Currently, `.rowbly/stories/* is a flat directory of all stories on the board. Update this so they are split up by stage. Example:

```
stages/
  BACKLOG.md
  IN_REFINEMENT.md
  ...
stories/
  BACKLOG/
    ROW-01.md
  IN_REFINEMENT/
    ROW-02.md
  ...
```
