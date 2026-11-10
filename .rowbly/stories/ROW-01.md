---
title: Nested command structure
stage: BACKLOG
worktree: null
pull_request: null
---

Currently the rowbly command structure is "flat". We have commands like so:

```
rowbly create-story
rowbly create-stage
```

Update this so they are "nested". Rather than `rowbly create-story` it should be `rowbly story create`.

As part of this work, make sure we have an optional `--help` flag that can be triggered at those stages. So running `rowbly story --help` or just `rowbly story` should show the help page for just stories.
