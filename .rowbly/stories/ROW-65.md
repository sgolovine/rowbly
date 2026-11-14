---
title: Show and edit Story dependencies in the TUI
stage: BACKLOG
worktree: null
pull_request: null
---

## Goal

Users can see and edit the dependencies of a Story in the TUI.

## Scope

- The General tab of a Story (`src/tui/screens/stories/story-general-tab/`) shows `Depends on` and `Blocks`. Each item shows the ID, the title and the Stage.
- The user can add an upstream Story with a picker of the Stories of the Project, and remove one. The picker does not show the Story itself or a Story that makes a cycle. A service error shows in the form.
- The new Story form can also set `Depends on`.
- A blocked Story row on the board shows a small blocked mark. Use only the colours of `theme`.
- The factory status line of a blocked Story in a work Stage shows `waiting for ROW-01, ROW-02`.
- Mouse and keys follow the rules of the `rowbly-tui-design` skill.

## Acceptance criteria

- [ ] The General tab shows both lists, and a change saves through the Story service.
- [ ] A change that makes a cycle is not possible from the picker.
- [ ] A blocked Story row shows the mark, and the mark goes away when the Story becomes ready.
- [ ] The status line shows the upstream IDs of a blocked Story.
- [ ] `docs/architecture/tui.md` describes the new fields and the mark, in STE.
- [ ] Screenshots of the General tab and the board are in the PR (see the `rowbly-screenshots` skill).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

Depends on ROW-60 and ROW-62. Read the `story-dependencies` Spec and the `rowbly-tui-design` skill.
Build from `src/tui/components/`. Do not put the blocked rule in a component; use `isBlocked` and `waitingFor` from the service.
Do not write tests for the TUI.
