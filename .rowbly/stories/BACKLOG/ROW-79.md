---
title: Add support for story tags.
stage: BACKLOG
position: 5
updatedAt: 2026-11-16T19:29:34.292Z
worktree: null
pull_request: null
---

- Add support for story tags
- A story may contain one or more tags.
- Tags have a label and a value. They are stored in rowbly config.
- Tag is created with a label and a value.
- The value cannot be changed after creation.
- When a tag is removed, we scan all stories and remove that tag from any story where it may exist.
