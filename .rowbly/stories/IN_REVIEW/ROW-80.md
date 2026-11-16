---
title: Story tags in the TUI
stage: IN_REVIEW
position: 79
dependsOn:
  - ROW-79
createdAt: 2026-11-16T19:30:18.067Z
updatedAt: 2026-11-16T21:38:30.202Z
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-80
pull_request: https://github.com/sgolovine/rowbly/pull/266
---

Split from ROW-79.

## Goal

A user can manage Story tags and the tags of each Story in the TUI. ROW-79 added the tag service (`src/services/tag/tag.ts`), the config key `tags`, the Story frontmatter key `tags`, `Story.tags` and the CLI commands. This Story adds the TUI part. Today, a TUI user cannot see or change tags.

Original request of the author:

- A Tags section in the Settings modal to add a tag (label and value), change the label and remove a tag (with a confirmation, because the removal also removes the tag from all Stories). The value cannot be changed after creation.
- Show the tags of a Story in the Story detail view and on the board cards.
- Select the tags of a Story in the new Story form and in the edit Story form.
- Use only the services of ROW-79. Do not put domain logic in the TUI.

## Scope

In scope:

- A new Settings section "Tags" in the Project group, after "Custom Fields": list, add, edit the label, remove with a confirmation.
- A "Tags" multiselect field in the new Story form and in the edit Story form (the General tab of the Story sidebar). The edit form is the Story detail view of the TUI, so this field also shows the saved tags of the Story.
- The tag labels of a Story on its row in the Story list (the board card, `StoryRow`).
- The update of `docs/architecture/tui.md` if it lists the Settings sections or the slots of a Story row (STE language).

Not in scope:

- Changes to the tag service, the config, the Story service or the CLI (ROW-79 did them). If a small service helper is necessary, it goes in `src/services/` with a test.
- A filter of the Story list or of the Story finder by tag.
- Colours or other display options of a tag.
- Tags in the factory messages or prompts.
- TUI tests (the repository does not test the TUI).

## Acceptance criteria

- [ ] Settings has a "Tags" section in the Project group, directly after "Custom Fields", with a one-line description (for example "The tags that a Story can have."). A person examines this in the TUI.
- [ ] The Tags section lists each tag of `listTags()` in config order, with its label and its value in two aligned columns. With no tags, it shows "No Tags. Press n to add one.". A person examines this.
- [ ] `n` or the "+ New Tag" Button opens a form Modal with "Label" and "Value" (both required). Save calls `addTag`. The new tag is in `.rowbly/rowbly.config.json` (examine the file). A duplicate value or a bad value shows the service error on the form or as a toast, and the Modal stays open.
- [ ] `enter`, `e` or a click on a row opens an edit Modal with only the "Label" field. The Modal title shows the value (for example `Edit Tag › frontend`). Save calls `updateTag`. The value and the Stories do not change (examine the config and a Story file).
- [ ] `d` on a row opens a destructive `ConfirmDialog` with a message that says that Rowbly also removes the tag from each Story. Confirm calls `removeTag`. The tag is not in the config, and no Story file has the tag value. Cancel changes nothing.
- [ ] After each add, edit or remove, the section reloads the list and calls `onChange()`, so that the board, the Story forms and the Story rows show the new tags without a restart. A person examines this.
- [ ] The new Story form has a "Tags" multiselect field after "Depends on". Its options are the tag values of the Project, and each option shows the tag label. A Story created with tags has these values in its `tags` frontmatter (examine with `rowbly story get <id> --json`).
- [ ] The edit Story form has the same "Tags" field, with the saved tags of the Story selected. Save sends the full list as `tags` to `updateStory` only when the list changed. A save that removes all tags removes the `tags` key from the Story file.
- [ ] When the Project has no tags, the Story forms do not show the "Tags" field.
- [ ] A Story value that is not a tag of the Project (a stale value) does not break the edit form. It shows as its value, and the user can remove it.
- [ ] A Story row in the Story list shows the labels of the tags of the Story (in the order of the Story), in `theme.inkMuted`, between the title and the other slots. The title keeps its room: the tag slot truncates first (`wrap="truncate-end"`, `flexShrink`). A Story without tags shows no tag slot. A person examines this at a narrow terminal width.
- [ ] The TUI imports only services of ROW-79 for tags (`listTags`, `addTag`, `updateTag`, `removeTag`, `projectTags`, `createStory`, `updateStory`). No tag rule (validation, duplicate check, removal from Stories) is in `src/tui/`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- **Base branch.** At the time of refinement, the worktree HEAD did not contain ROW-79. ROW-79 is on `origin/main` (merge commit `adbb56b6`, PR #263). Before you start, merge or rebase onto `origin/main` and make sure that `src/services/tag/tag.ts` exists.
- Read `.agents/skills/rowbly-code-style/SKILL.md` and `.agents/skills/rowbly-tui-design/SKILL.md` first. Use only the colours in `theme` and the components in `src/tui/components/`.
- **Settings section.** Copy the pattern of `src/tui/screens/settings/custom-fields-section/custom-fields-section.tsx`, `custom-field-form-modal/` and `custom-field-row/`. Create `tags-section/`, `tag-form-modal/` and `tag-row/` (dash-case, one component per folder, with `index.ts`). Export them in `src/tui/screens/settings/index.ts`. Register the section in `SETTINGS_GROUPS` of `src/tui/screens/settings/settings-sections.ts` with id `tags`.
- The tag service: `listTags(ctx)`, `addTag({ label, value }, ctx)`, `updateTag({ value, label }, ctx)`, `removeTag({ value }, ctx)` in `src/services/tag/tag.ts`. Errors are `ValidationError` (issue paths `label`, `value`), `ConflictError` and `NotFoundError`. `FormModal` maps `ValidationError` issue paths to the fields; the Form field names must be `label` and `value`.
- The form Modal has no read-only field kind. For the edit, give only the `label` field, and put the value in the title.
- **Story forms.** `src/tui/screens/stories/story-form.ts`: add a `tags` parameter (`readonly TagConfig[]`) to `storyFormFields`. Add `{ name: "tags", label: "Tags", kind: "multiselect", options, optionLabels }` after `dependsOn` when the list is not empty. For a stale Story value, add it to `options` with its value as label (the same as `dependencyChoices` does for a missing upstream Story).
- `new-story-form.tsx`: initial value `tags: []`. Pass `tags` to `createStory`.
- `edit-story-form.tsx`: initial value `tags: [...story.tags]`. Pass `tags` to `updateStory` only when the list is different from `story.tags` (otherwise `undefined`). Use the full list (`tags`), not `addTags`/`removeTags`.
- `src/tui/shell/story-sidebar-form/story-sidebar-form.tsx`: pass `projectTags(board.project)` to both forms. `board.project` is a `Project`, which extends `ProjectConfig`.
- **Story row.** `src/tui/screens/stories/story-row/story-row.tsx`: add a prop with the tag labels (or the `TagConfig[]` of the Project) and pass it from `story-list-item/story-list-item.tsx` and its parents. Map each value to its label with a pure function. A stale value shows as its value. Keep `StoryRow` free of service calls.
- No change to `src/services/`. If the mapping of values to labels is useful in more than one place, a pure function in `src/tui/screens/stories/` is sufficient.

## Assumptions

- The Story detail view is the General tab of the edit Story form in the Story sidebar. The TUI has no other Story detail view. The "Tags" multiselect field shows the saved tags there, so no separate read-only list is added. Reason: smallest scope that shows the tags, and it agrees with how `Depends on` works.
- The board card is `StoryRow` in the Story list. Reason: the TUI shows Stories as rows of a list in Stage sections.
- The Story row shows tag labels, not values, in `theme.inkMuted`, with no colour per tag. Reason: labels are for people; colours are out of scope in ROW-79.
- The "Tags" field is hidden when the Project has no tags. Reason: an empty multiselect has no use; the user adds tags in Settings.
- The Tags section is in the Project group after "Custom Fields". Reason: tags are Project config, the same as custom fields.
- The edit form sends the full list (`tags`) and not `addTags`/`removeTags`. Reason: the form has the full list, and the service validates it.
- No filter by tag in the TUI. Reason: the request does not ask for it.
