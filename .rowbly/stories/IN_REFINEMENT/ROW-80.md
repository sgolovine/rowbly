---
title: Story tags in the TUI
stage: IN_REFINEMENT
dependsOn:
  - ROW-79
createdAt: 2026-11-16T19:30:18.067Z
updatedAt: 2026-11-16T19:30:44.480Z
worktree: null
pull_request: null
---

Split from ROW-79.

Show and edit Story tags in the TUI. ROW-79 adds the tag service, the config key `tags`, the Story frontmatter key `tags` and the CLI commands. This Story adds the TUI part:

- A Tags section in the Settings modal to add a tag (label and value), change the label and remove a tag (with a confirmation, because the removal also removes the tag from all Stories). The value cannot be changed after creation.
- Show the tags of a Story in the Story detail view and on the board cards.
- Select the tags of a Story in the new Story form and in the edit Story form.

Use only the services of ROW-79. Do not put domain logic in the TUI.
