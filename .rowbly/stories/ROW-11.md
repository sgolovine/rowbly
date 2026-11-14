---
title: Move New/Edit story modal to sidebar
stage: IN_REFINEMENT
position: 1
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-11
pull_request: null
---

## Goal

Today, the TUI opens a new Story and an edit of a Story in a Modal over the Story list. The Modal hides the list.
The user wants a Story sidebar on the right side of the Story list (see the attached screenshot, orange frame).
The Story sidebar is the new place to create and edit a Story. The user can see the Story list while the Story sidebar is open.

Original request from the author:

- The sidebar should have the same header as all other windows and should be navigable to just like the other tabs.
- There should be an "X" on the far right side to let me close it. On the border like the header text.
- For now, just migrate the existing UIs that we have in create and edit mode for stories into this new sidebar.
- Must be able to adjust width of sidebar just like other panes.

## Scope

In scope:

- A new Story sidebar: a `Panel` on the right of the Story panel, with the full height of the main area.
- Move the content of `NewStoryModal` (the new Story form, with image paste) into the Story sidebar.
- Move the content of `StoryModal` / `EditStoryModal` (the General, Specs, Attachments and Threads tabs) into the Story sidebar.
- A title in the top border, as in the other panels, and a `✕` close button at the right end of the top border.
- Focus movement between the Stage sidebar, the Story list and the Story sidebar.
- A drag of the left edge of the Story sidebar changes its width, as the Stage sidebar does with its right edge.
- Updates to the key hints, the help overlay (`GLOBAL_KEYS`), the tests and `docs/architecture/tui.md`.

Not in scope:

- New fields, new tabs or other changes to the content of the create and edit forms.
- The Stage form, Settings, Factory controls, the Project switcher, the Story finder and the help overlay. They stay Modals.
- The confirmation of a delete from the Story list (`d`). It stays a `ConfirmDialog`.
- Persistence of the Story sidebar width after Rowbly quits. The Stage sidebar width also does not persist.

## Acceptance criteria

- [ ] In the Story list, `n`, `+ New Story` in the header and `n` hints open the new Story form in the Story sidebar on the right of the Story list. No Modal opens. The Story list stays visible. A `renderTui` test of `Shell` examines this.
- [ ] `enter` or a click on a Story, and a pick in the Story finder, open the edit form of that Story in the Story sidebar, with the General, Specs (when Specs are on), Attachments and Threads tabs. A test examines this.
- [ ] The Story sidebar is a `Panel`. Its top border shows the title `New Story` or `Edit <story-id>`, as the modals show today. The border is `theme.accent` when the Story sidebar has the focus, and `theme.border` when it does not have the focus. A test examines this.
- [ ] The top border of the Story sidebar has a `✕` (`CloseButton`) at its right end. A click on it closes the Story sidebar. If the form has unsaved text or images, Rowbly first shows the discard confirmation, as the Modal does today. A test examines this.
- [ ] When the Story sidebar opens, it has the focus. While the Story list has the focus and the Story sidebar is open, `tab` moves the focus to the next pane in this order: Stage sidebar (when shown), Story list, Story sidebar. A click on a pane gives the focus to that pane. A test examines this.
- [ ] While the Story sidebar has the focus, `tab`, `shift+tab`, `enter` and `ctrl+s` keep the behavior that they have in the form today. `esc` moves the focus to the Story list and keeps the Story sidebar open with its draft. A test examines this.
- [ ] While the Story list has the focus and the Story sidebar is open, `esc` closes the Story sidebar. Unsaved changes show the discard confirmation first. A test examines this.
- [ ] A save of a new Story or of an edit keeps the current behavior: the toast, the selection of the Story in the list and the close of the Story sidebar. A test examines this.
- [ ] If the user opens a different Story or a new Story while the Story sidebar has unsaved changes, Rowbly shows the discard confirmation first. Without unsaved changes, the Story sidebar shows the new content at once. A test examines this.
- [ ] A drag of the left edge of the Story sidebar changes its width. The width is not less than `STORY_SIDEBAR_MIN_WIDTH`, and the Story list keeps at least `MAIN_MIN_WIDTH`. The width stays until Rowbly quits. A test of the frame calculation (`shell-frame.test.ts`) and a mouse test examine this.
- [ ] The discard confirmation and the delete confirmation (`ctrl+d`, Delete button) of the Story sidebar still show and work. A test examines this.
- [ ] `NewStoryModal`, `EditStoryModal` and `StoryModal` are not used by the shell any more. Remove the unused code, or keep only the parts that the Story sidebar uses. `pnpm lint` (Knip) passes.
- [ ] In a terminal that is narrower than `STACKED_BELOW_WIDTH`, or where the Story list and the Story sidebar do not both fit, the Story sidebar takes the full main area while it is open. A test of `shellFrame` examines this.
- [ ] The footer shows the key hints of the pane that has the focus. The help overlay lists the new focus and close keys.
- [ ] A person examines the layout in a real terminal with the `rowbly-screenshots` skill (only a person or the screenshot skill can examine this).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- Read `.agents/skills/rowbly-tui-design/SKILL.md`, `.agents/skills/rowbly-code-style/SKILL.md` and `docs/architecture/tui.md` first.
- Shell: `src/tui/shell/shell/shell.tsx` renders the Stage `Sidebar` and the `StoryPanel` in a row. Add the Story sidebar after `StoryPanel`. Put the new component in its own folder, for example `src/tui/shell/story-sidebar/` (one component per folder, with a test and an `index.ts`).
- State: `src/tui/shell/overlay.ts` has the `newStory` and `editStory` overlay kinds. Move them out of `Overlay` into a new shell state (for example `storyPane: { kind: "new" } | { kind: "edit"; story } | null`) in `use-shell.ts` and `shell-state.ts`. The other overlays must stay Modals over the shell.
- Focus: `Pane` in `shell-state.ts` is `"stages" | "stories"`. Add `"story"`. Update `paneKey` in `shell-keys.ts` and `shellView` in `shell-view.ts`. The shell `useInput` is active only when `view.idle` is true. The Story sidebar content must get the keys only when its pane has the focus (wrap it in `ActiveContext.Provider`, as `StoryPanel` does for onboarding).
- Layout: `src/tui/shell/shell/shell-frame.ts` calculates the widths. Add the Story sidebar width, and decrease `mainWidth`. Add the constants (`STORY_SIDEBAR_WIDTH`, `STORY_SIDEBAR_MIN_WIDTH`) to `src/tui/components/shell-layout.ts`. Give the Story sidebar content a `LayoutContext` with its inner size.
- Resize: `src/tui/components/sidebar/sidebar.tsx` has the drag logic (`resizeTo`, `useMouse` with `onPull` on an edge box). The Story sidebar drags at its left edge, so the width is `right - x + 1`. Extend or share this logic. Do not make a fork of `Sidebar`.
- Header and close: `Panel` (`src/tui/components/panel/panel.tsx`) has `title` and `aside`. `ModalFrame` already puts a `CloseButton` in `aside`. Use the same pattern.
- Content: `StoryModalBody` (`src/tui/screens/stories/story-modal-body/`) holds the edit tabs. `StoryModal` puts it in a `Modal`, and `requestClose` asks before a discard. `NewStoryModal` uses `FormModal` with `NewStoryImages`. The body and the forms use `ModalLayerContext` for nested dialogs, and `useCovered`, `useEscape` and `useKeyCapture`. Make sure that the nested `ConfirmDialog`s still have a layer host when the content is not in a `Modal`.
- The services do not change. `createStory`, `updateStory` and `deleteStory` stay the same.
- Update the `Shell` doc comment, `GLOBAL_KEYS` in `src/tui/keymap.ts`, `docs/architecture/tui.md` (the `stories/` row of the area table), and the `story-modal.md` guideline of the design skill if it describes the Modal.

## Assumptions

- The Story sidebar is on the right of the Story list. Reason: the attached screenshot marks the right side of the Story list.
- "The same header as all other windows" means the `Panel` title in the top border, and the titles are `New Story` and `Edit <story-id>`. Reason: the other panes use the `Panel` title, and these are the titles of the modals today.
- "Navigable like the other tabs" means focus movement between panes with `tab` and a click, as between the Stage sidebar and the Story list. Reason: the shell uses `tab` for pane focus today.
- In the Story sidebar, `tab` stays the next-field key of the form, and `esc` moves the focus to the Story list. `esc` in the Story list closes the Story sidebar. Reason: the form already uses `tab`. `esc` in the Stage sidebar moves the focus to the Story list today, so this agrees with the existing code.
- Only the new and edit Story forms move. The other Modals stay. Reason: the author says "for now, just migrate" the create and edit UIs.
- The default width is 40% of the terminal width, with a minimum of 40 columns (`STORY_SIDEBAR_MIN_WIDTH`). The width does not persist after Rowbly quits. Reason: the screenshot shows approximately one third of the width, the edit tabs need room, and the Stage sidebar width also does not persist.
- In a narrow terminal, the Story sidebar takes the full main area. Reason: this is the smallest change that keeps the form usable, and the shell already changes its layout below `STACKED_BELOW_WIDTH`.
- When the user opens a different Story while the Story sidebar has unsaved changes, Rowbly asks before it discards them. Reason: the current Modal asks before it discards unsaved text or images.
- One pull request can hold this work, so the Story is not split. Reason: the services do not change, and the existing form content moves without changes.
