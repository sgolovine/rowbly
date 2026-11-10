---
title: Attach items to stories
stage: DONE
position: 7
worktree: /home/sgolovine/.t3/worktrees/rowbly/row-02-in_development
pull_request: https://github.com/sgolovine/rowbly/pull/185
---

## Goal

Users can attach PNG images to a Story from the clipboard or a local file. Restore the attachment behavior from commit `79a874044292e1fddf3046235a31b8305c10f936` in the current Rowbly application.

The original request calls these attachments "items". The specified legacy implementation supports PNG images, not arbitrary files or clipboard text.

## Scope

Restore image paste, file input, attachment lists, open, remove, draft images, and attachment counts. Include CLI commands, shared services, persistent files, and the TUI. This bounded feature fits one pull request.

Attachments work independently of Specs. Use the current Project and Story architecture. Do not restore Boards, Plugins, Assignees, or the legacy operation framework. Do not add a feature switch. Do not migrate legacy Projects in this Story.

Other image formats, arbitrary files, URL attachments, inline image previews, and clipboard text attachments are outside scope. Normal text paste must retain its current behavior.

## Acceptance criteria

- [ ] A user can attach a PNG from a local path through the CLI and the Attachments tab. The source file stays unchanged.
- [ ] Each attachment accepts at most 10 MiB, including the exact limit. Reject larger input and input without the PNG signature before persistence.
- [ ] Each attachment has a unique safe ID, basename, `image/png` type, byte size, and ISO-8601 creation time. Keep insertion order. File input keeps its basename. Clipboard input uses `image-YYYYMMDD-HHMM.png` in UTC. No creator field is necessary because the current application has no Me concept.
- [ ] Add, list, open, and remove commands use the shared attachment services. Register `add-attachment <story> [file]` with `--from-clipboard`, `list-attachments <story>`, `open-attachment <story> <id>`, and `remove-attachment <story> <id>`. Add accepts exactly one file or clipboard input. Commands support the existing `-C`, `--json`, and typed error conventions.
- [ ] JSON add returns the attachment record. List returns ordered records. Open returns `{ opened: id }`. Remove returns `{ removed: id }`. Unknown Stories or attachment IDs produce typed errors.
- [ ] The Story modal has an Attachments tab with Specs on or off. The tab shows each saved image's name, size, and local creation date. Show a useful empty state.
- [ ] The tab supports keyboard and mouse selection. Visible hints expose `n` for a PNG path form, `o` to open, and `d` to remove. Removal asks for confirmation. Open uses the platform's associated application and reports failures.
- [ ] Ctrl+V, Alt+V, Ctrl+Alt+V, and empty bracketed paste read an image on an active Story tab or create/edit form. Text paste remains text. Covered or inactive screens do not read images. Show a platform-appropriate paste hint.
- [ ] In the current create/edit forms, pasted images remain in memory until Story save. This includes the General, Specs, and Attachments tabs of the edit modal. Show pending image count and total size. Limit pending images to 10 MiB in total. Keep pending images after a failed save. Confirm discard when pending images exist, even when no text changed.
- [ ] A successful form save persists the Story and pending images without duplicates. A failed save leaves no partial attachment records or files. A PNG added through the Attachments tab's path form saves immediately to the existing Story. Existing saved attachments remain after draft changes are discarded.
- [ ] Paste shows progress and success or failure. Only one clipboard read runs at a time. If the user closes or changes the Story during a read, discard its result. Never attach that result to another Story.
- [ ] Clipboard access supports macOS, Windows, Linux X11, and the legacy Wayland fallback through `wl-paste`. Native clipboard code runs in a disposable child process. A crash or hang cannot terminate or block Rowbly. Native access and fallback share a three-second deadline and bounded output.
- [ ] Clipboard failures distinguish `unsupported`, `no-display`, `no-image`, `too-large`, and `timeout`. Save nothing on failure. For unavailable clipboard access, show the file command as a fallback. Explain the `wl-clipboard` prerequisite when applicable. Ordinary CLI startup does not load native clipboard code.
- [ ] Saved attachment bytes and metadata survive restart, ordinary Story edits, and Stage changes. Remove deletes the selected record and its PNG together. Story deletion removes its attachments. A Project key change preserves ownership. Validate IDs and prevent paths outside the attachment directory.
- [ ] Story rows show the saved attachment count when nonzero. Attachment names participate in Story search. Draft images do not count as saved images.
- [ ] `doctor` reports malformed attachment metadata, missing referenced PNGs, and orphan PNGs. A fix can remove missing-file references from valid metadata. Preserve orphan bytes and malformed metadata for recovery.
- [ ] Service and CLI tests cover persistence, validation, errors, deletion, and Project key changes. Component tests cover paste ownership, draft save/discard, tab actions, and text paste. Test clipboard process failures without a desktop dependency. Run the repository checks and inspect the TUI through `agentic-tui`.

## Technical notes

The legacy commit is the behavior reference. Relevant files at that commit are:

- `src/plugins/attachments/attachments.ts`, `model.ts`, `commands.ts`, `tui.ts`, and `AttachmentsTab.tsx`.
- `src/tui/hooks/useStoryPaste.ts` for paste guards, progress, and pending images.
- `src/storage/clipboard.ts` and `docs/agents/adr/0037-clipboard-reads-use-an-isolated-native-child.md` for clipboard isolation and Wayland behavior.

The current application has no clipboard reader or attachment service. Keep domain logic in a new `src/services/attachment/` module. Keep clipboard process access in a separate plain TypeScript module. Review the native dependency and its package behavior before reuse. Verify source execution and the installed bundle.

Use `.rowbly/attachments/<Story ID>/` for attachment metadata and PNG files. Keep the current `.rowbly/stories/<Story ID>.md` format. An ordered JSON manifest can hold the attachment records. Use generated IDs for PNG filenames. Do not use user-supplied basenames as storage paths. Validate all metadata before writes. Coordinate metadata and byte writes with rollback so failed operations keep the previous valid state.

Integrate lifecycle changes with `src/services/story/story.ts`, Project key changes with `src/services/project/project.ts`, and checks with `src/services/doctor/doctor.ts`. Add attachment names to `searchStories` without dependence on a desktop clipboard.

Adapt `NewStoryModal`, `EditStoryModal`, `StoryModal`, `StoryModalBody`, and `StoryRow` under `src/tui/screens/stories/`. The current Story modal is an edit form; keep its unsaved text and images together. General stays first. Specs appears only when enabled. Attachments appears last in both configurations. Extend the shared components and follow `.agents/skills/rowbly-tui-design/SKILL.md`.

No Specs are linked to ROW-02 at refinement. The legacy reference resolves the original request; no open product questions remain.
