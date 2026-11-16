---
title: Re-number a Story automatically when two Story files have the same ID
stage: BACKLOG
createdAt: 2026-11-16T19:31:02.777Z
updatedAt: 2026-11-16T19:31:02.777Z
worktree: null
pull_request: null
---

When two Story files have the same Story ID, Rowbly must re-number the newer Story automatically and refresh the UI.

## Problem

Two Story files can get the same ID. For example, an older `rowbly` build reads only the flat `stories/` folder, so it does not see a Story in a Stage folder and gives out its number again. A Git merge of two branches can also cause this.

On 2026-11-16, `stories/BACKLOG/ROW-77.md` ("Add support for story tags") and `stories/IN_DEVELOPMENT/ROW-77.md` ("Expand and collapse the Story sidebar") had the same ID. The TUI keeps the selection by Story ID. Thus the cursor could not go to the second `ROW-77`: it always went back to the first. Today `rowbly doctor` only reports the error ("Story ID ROW-77 is also used by …"), and `--fix` does nothing.

## Goal

Rowbly finds a duplicate Story ID and gives the newer Story the next free number. The older Story keeps its ID. The TUI then shows the two Stories with different IDs, and the user can select each of them.

## Scope

- Find the duplicates: two or more Story files with the same Story ID or number, in one folder or in different folders (the flat `stories/` folder and the Stage folders).
- Select the newer Story: the Story with the later `createdAt`. If a Story has no `createdAt` (the older builds do not write it), use a fallback rule, for example the file modification time. The refinement must decide the rule.
- Re-number the newer Story to the next free number of the Project. Move its file to `stories/<stage key>/<projectKey>-<n>.md`.
- Update the references to the old ID of the newer Story, if Rowbly can identify them (for example `dependsOn` of other Stories, its attachment folder). The refinement must find all references and decide which belong to which Story.
- Do the repair automatically when the board loads or reloads after a file change (the TUI file watch), and in `rowbly doctor --fix`.
- Refresh the TUI after the repair, so that the list shows the new ID.
- Tell the user about the change, for example a TUI notice and a `doctor` line: "ROW-77 → ROW-79: duplicate ID".
- Update `docs/architecture/storage.md` (the doctor table) and the applicable docs.

## Not in scope

- A change to the older builds of `rowbly`.

## Open questions for refinement

- A Story that the factory works on (it has a Thread, a worktree or a branch) must not lose its ID. If the newer Story has factory state, re-number the other Story, or only report the problem?
- Which service owns the repair, and does it take the Project write lock? (Never take the Project write lock while you hold the state lock.)
- Must the repair be safe when two Rowbly processes (TUI and factory daemon) find the duplicate at the same time?
