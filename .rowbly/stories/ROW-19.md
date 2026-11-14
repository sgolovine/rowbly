---
title: Factory Git settings in the TUI
stage: IN_REFINEMENT
worktree: null
pull_request: null
---

Split from ROW-17. Show and edit the factory Git settings (commit author, commit message, periodic push, periodic pull and the sync interval) in the TUI settings. The settings are in the `git` section of `.rowbly/factory.json`, from ROW-17 and the periodic sync Story. The TUI calls the same `factory-settings` service as `rowbly factory configure`.
