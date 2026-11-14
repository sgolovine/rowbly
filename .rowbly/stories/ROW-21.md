---
title: Edit worker model overrides in the TUI
stage: IN_REFINEMENT
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-21
pull_request: null
---

Split from ROW-20.

Let a person see, set and clear the worker model overrides of ROW-20 in the TUI:

- The Stage override (Settings, Stages section or AI section).
- The Story override for each Stage (the Story modal).

ROW-20 adds the storage in `.rowbly/factory.json`, the services, the resolution order and the `rowbly factory configure` flags. This Story adds only the TUI. Use the existing model picker modal (`src/tui/screens/settings/model-picker-modal/`).
