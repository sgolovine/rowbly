---
title: Periodic Git push and pull in the factory
stage: IN_REFINEMENT
worktree: null
pull_request: null
---

Split from ROW-17. Add periodic Git sync to the native factory. The factory pushes the canonical commits that it makes, and it pulls changes from the remote at an interval. Often the factory makes commits but does not push them. Use the `git` settings in `.rowbly/factory.json` that ROW-17 adds. Add settings to turn push and pull on and off, and a sync interval. The CLI command `rowbly factory configure` sets them. Push and pull failures show as factory attention items and do not stop the factory.
