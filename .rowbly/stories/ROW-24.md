---
title: Add more space between active and inactive threads accordions
stage: IN_DEVELOPMENT
position: 3
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-24
pull_request: null
---

## Goal

In the Factory view (the `threads` view mode of the right Panel), the "Active Threads" section and the "Inactive Threads" section show directly one after the other. When the two sections are open, it is sometimes hard to see which Thread is in which section. The attached screenshot shows the problem: the last Active Thread row and the "Inactive Threads" heading touch.

The user gets one empty line above the "Inactive Threads" heading, so the two sections are clearly separate.

## Scope

In scope:

- One empty line between the end of the "Active Threads" section and the "Inactive Threads" heading, in `FactoryView`.
- The empty line shows when the "Active Threads" section is expanded and when it is collapsed. (A constant layout keeps the headings in the same positions.)
- Update of the tests and of the docs line that describes the sections.

Not in scope:

- An empty line above the first section ("Active Threads").
- Changes to the Thread rows, the heading text, the colours, the keys or the selection logic.
- The Thread list of the Story sidebar (`thread-list-panel`).

## Acceptance criteria

- [ ] In the Factory view, the line directly above "▾ Inactive Threads" (or "▸ Inactive Threads") is empty, with the "Active Threads" section expanded and also collapsed. A test in `src/tui/screens/threads/factory-view/factory-view.test.tsx` examines the frame for this.
- [ ] No empty line shows above the "Active Threads" heading. A test examines this.
- [ ] The empty line is not a selectable row: `↑/↓` and `j/k` go from the last Active Thread (or the collapsed Active heading) directly to the "Inactive Threads" heading. The existing navigation tests continue to pass.
- [ ] A click on the "Inactive Threads" heading continues to collapse and expand the section (existing test passes).
- [ ] When the list is longer than the Panel, the scroll of `ScrollBody` continues to bring the selected row into the view (manual check in a real terminal, or the existing scroll tests).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- `src/tui/screens/threads/factory-view/factory-view.tsx` renders the rows of `factoryViewRows` in a `ScrollBody`. Each section row is a `ThreadSectionRow` (`src/tui/screens/threads/thread-section-row/thread-section-row.tsx`).
- Recommended change: give `ThreadSectionRow` an optional prop (for example `spaced: boolean`) that wraps the `SelectionRow` in `<Box marginTop={1}>` or adds the margin, and set it in `FactoryView` for each section heading that is not the first row (`index > 0`). Alternative: wrap the heading in `FactoryView`. Do not add a new row kind to `FactoryViewRow`, because the cursor index in `factory-view-actions.ts` must stay equal to the selectable rows.
- Keep the margin outside the highlight of `SelectionRow`, so that the empty line does not show the selection background.
- `ScrollBody` (`src/tui/components/scroll-body/scroll-body.tsx`) measures the content height, so the extra line is in the scroll count automatically.
- Update `thread-section-row.test.tsx` if the prop is added to the component.
- Update `docs/architecture/tui.md`, section "The Factory view", bullet "The sections": add that one empty line separates the two sections. Write in ASD-STE100 STE.
- Obey `.agents/skills/rowbly-tui-design/SKILL.md` and `.agents/skills/rowbly-code-style/SKILL.md`.

## Assumptions

- The empty line also shows when the "Active Threads" section is collapsed or empty. Reason: the author asks for space "between the accordions"; a constant layout is simpler and the headings do not move when a section collapses.
- The space is exactly one line. Reason: the author asks for "a line of empty space".
- The change applies only to the Factory view, not to the Thread list of the Story sidebar. Reason: the screenshot and the text are about the Active and Inactive Threads sections of the Factory view.
