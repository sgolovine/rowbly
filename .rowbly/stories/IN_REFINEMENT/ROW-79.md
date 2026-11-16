---
title: Add support for story tags.
stage: IN_REFINEMENT
position: 1
updatedAt: 2026-11-16T19:29:36.629Z
worktree: null
pull_request: null
---

- Add support for story tags
- A story may contain one or more tags.
- Tags have a label and a value. They are stored in rowbly config.
- Tag is created with a label and a value.
- The value cannot be changed after creation.
- When a tag is removed, we scan all stories and remove that tag from any story where it may exist.
