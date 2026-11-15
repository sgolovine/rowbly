---
title: Add `createdAt` and `updatedAt` frontmatter.
stage: DONE
position: 67
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-26
pull_request: https://github.com/sgolovine/rowbly/pull/254
---

## Goal

A Story file does not record when the Story was created or when it last changed. Add two optional
frontmatter keys to each Story file:

- `createdAt`: the time when the Story was created.
- `updatedAt`: the last time that the Story changed.

The user can then see the age of a Story and the time of its last change. Rowbly stores the times in
UTC. The TUI shows them in the time zone of the user. The user can change this time zone in the
settings.

## Scope

In scope:

- `createdAt` and `updatedAt` in the frontmatter of each new Story and each changed Story.
- The two values in the `Story` record of the service layer and of the CLI JSON output.
- The two values in the human output of `rowbly story get`.
- The two values in the General tab of the Story form in the TUI, in the selected time zone.
- A new display option `display.timeZone` in `.rowbly/rowbly.config.json`, with a field in the
  Display section of the TUI settings and a `rowbly project update --time-zone <zone>` flag.
- Updates of `docs/architecture/storage.md`, `skills/rowbly-reference.md` (and its copies in
  `skills/<name>/references/`) and the CLI docs for the new keys and the new flag.

Not in scope:

- No backfill. Old Stories keep no `createdAt` until they change, and they get no `createdAt` then.
- No sort or filter by the new times in `story search`, the board or the TUI.
- No change to the other dates of the TUI (Threads, attachments, factory). They keep the system
  time zone.
- No `rowbly doctor` check for a missing value.

## Acceptance criteria

- [ ] `rowbly story create` writes `createdAt` and `updatedAt` to the new Story file. Both have the
      same value, an ISO 8601 UTC string from `Date.prototype.toISOString()` (for example
      `2025-01-02T03:04:05.678Z`). The service uses `ctx.now?.() ?? new Date()`, so a test can set the time.
- [ ] `rowbly story update` with any change (title, stage, position, description, custom field,
      dependencies, images) sets `updatedAt` of that Story to the current time. `createdAt` does not change.
- [ ] An update that does not change the Story file (for example, an addition of a dependency that is
      already in the list) does not change `updatedAt`.
- [ ] The bulk changes of Story files also set `updatedAt` of each Story file that they change: a
      stage rename, a stage delete that moves Stories, a custom field add, rename or remove, a Project
      key change that changes `dependsOn`, the removal of a deleted Story from a `dependsOn` list, and a
      `rowbly doctor --fix` repair of a Story file.
- [ ] The attachment add and remove commands (`addAttachment` and `removeAttachment`) set `updatedAt` of the Story.
- [ ] When a Story moves to a new place, the other Stories of the stage that get a new `position`
      keep their old `updatedAt`.
- [ ] A Story file without `createdAt` or `updatedAt` reads without an error. The `Story` record
      gives `null` for a missing value or for a value that is not a valid date string.
      An update of such a Story adds `updatedAt` and does not add `createdAt`.
- [ ] The `Story` record (`rowbly story get --json`, `story search --json`, `story create --json`,
      `story update --json`) has `createdAt: string | null` and `updatedAt: string | null`.
- [ ] In the frontmatter, `createdAt` and `updatedAt` come after `dependsOn` and before the custom
      fields. The values are YAML strings and read back as strings (not `Date` objects).
- [ ] `rowbly story get` (without `--json`) shows a `Created:` and an `Updated:` line. A missing value shows `—`.
- [ ] `rowbly project update --time-zone Europe/Berlin` saves `display.timeZone: "Europe/Berlin"`.
      `--time-zone ""` removes the key. A name that `Intl.DateTimeFormat` does not accept gives a
      `VALIDATION` error, and `readConfig` reports an invalid `display.timeZone` as a config issue.
- [ ] The Display section of the TUI settings has a Time zone field. It shows the saved zone, or the
      system zone when no zone is saved. Only a person can examine this criterion.
- [ ] The General tab of the Story form shows "Created" and "Updated" in the saved time zone, or in
      the system time zone when no zone is saved. Only a person can examine this criterion.
- [ ] The service tests in `src/services/story/`, `src/services/story-files/`,
      `src/services/attachment/`, `src/services/config/` and `src/services/project/` cover the
      criteria above. `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- Story frontmatter is written only by `writeStoryFile` in `src/services/story-files/story-files.ts`.
  The bulk writes go through `rewriteStories` and `rewriteStory` in the same file. Callers:
  `story/story.ts` (create, update, `writePosition`), `story/story-dependencies.ts`
  (`removeDependencies`), `stage/stage.ts`, `custom-field/custom-field.ts`, `project/project.ts`,
  `doctor/story-checks.ts` and `doctor/story-dependency-checks.ts`.
- A good design: `writeStoryFile` gets an optional time. With a time, it sets `updatedAt`. The peer
  position writes in `writePosition` (`moved === false`) do not give a time. `rewriteStories` gives
  `ctx.now?.() ?? new Date()` to each Story that it changes. Pass the time through the call chain;
  do not call `new Date()` deep inside a helper.
- Add `"createdAt"` and `"updatedAt"` to `LEADING_KEYS` after `"dependsOn"`.
- `createStory` in `src/services/story/story.ts` builds the frontmatter in `newStoryData`. It already
  uses `ctx.now?.() ?? new Date()` for the images.
- `toStory` in `src/services/story/story-read.ts` builds the `Story` record. Read the values like
  `dependsOnOf` reads `dependsOn`: a bad value does not make the board unreadable.
- `src/services/attachment/attachment.ts` (`addAttachment`, `removeAttachment`) does not write the
  Story file now. After a successful change, it must set `updatedAt` with `writeStoryFile`.
- The YAML parser is `yaml` v2 (`src/services/markdown/markdown.ts`). Its default core schema does
  not parse timestamps, so an ISO string stays a string. Add a test that proves this.
- Display options: `DisplayConfig` and `DISPLAY_OPTIONS` in `src/services/config/config-types.ts`,
  the checks in `displayIssues` of `src/services/config/config-issues.ts` (now it accepts only
  booleans), the copy in `parseConfig` of `src/services/config/config.ts`, and `updateProject` in
  `src/services/project/project.ts`. The flag goes in `src/commands/project/project.ts` next to
  `--compact-threads`.
- TUI: `src/tui/screens/settings/display-section/display-section.tsx` and
  `src/tui/screens/stories/story-general-tab/story-general-tab.tsx`. `formatDateTime` in
  `src/tui/theme.ts` formats with the system time zone. Give it an optional `timeZone` argument
  (`toLocaleString(..., { timeZone })`). Read the `rowbly-tui-design` skill first.
- The CLI human output of a Story is in `src/commands/story/story.ts` (near `Depends on:`).
- The custom field keys must match `^[a-z][a-z0-9_]*$`, so a custom field cannot use `createdAt` or
  `updatedAt`. No change to `RESERVED_FIELD_KEYS` is necessary.
- After a change to `skills/rowbly-reference.md`, copy it to each `skills/<name>/references/rowbly-reference.md`.

## Assumptions

- The times are stored as ISO 8601 UTC strings, and the time zone applies only to the display.
  Reason: the author wrote "UTC", and a stored UTC value does not change when the user changes the zone.
- The time zone setting is the project display option `display.timeZone` in `rowbly.config.json`,
  not a key in `~/.rowblyrc.json`. When it is not set, Rowbly uses the system time zone.
  Reason: the Display section of the settings already edits project display options, and the safety
  rules make writes to `~/.rowblyrc.json` risky. The system zone is the "current timezone" of the user.
- The new time zone applies only to the Story times. Reason: smallest scope; the author asked only
  about the Story times.
- "Any update" includes the bulk changes, `doctor --fix` and attachment changes, because each one
  changes the Story. Reason: the author wrote "literally any event where a change was made to the story".
- The new `position` of a peer Story, when a different Story moves, does not change `updatedAt` of
  the peer. Reason: the peer itself did not change; only the board order changed. Without this
  rule, one move would change the time of all Stories of the stage.
- Old Stories get no backfill, and an update does not add `createdAt` to them. Reason: Rowbly does
  not know the real creation time, and a wrong time is worse than no time.
- The frontmatter keys use camelCase (`createdAt`, `updatedAt`) like `dependsOn`. Reason: the author
  gave these names.
