# Check and repair a Rowbly Data Root

Run doctor:

- after every git merge, pull or rebase that changed `.rowbly/`;
- when any command exits 6 (`DATA_INTEGRITY`);
- after `rowbly.config.json` or `board.config.json` was edited by hand.

## 1. Check

```sh
rowbly doctor --json --no-prompt
```

The result is a DoctorReport, `{ findings, fixed, summary: { errors, warnings, info } }`. Each finding has a
`code`, a `severity`, a `path` relative to `.rowbly/` (the Home Config's own path for a Home Config
finding), a message, and whether it is fixable. Doctor exits 0
when there are no errors, and 6 while errors remain. Warnings and info do not change the exit code.

## 2. Fix what is safe

If the Git Plugin is enabled, its Automatic Commits also observe saved doctor repair passes. To inspect all repairs and obtain doctor exit 0 before the next commit, pause Git first with `rowbly plugins disable git --json --no-prompt`. Remember whether it was enabled; restore it with `plugins enable git` only after repairs pass doctor. Disabling is shared Data Root configuration and retains pending paths. Keep other Plugins enabled so their doctor checks and fixes still run.

```sh
rowbly doctor --fix --json --no-prompt
```

`--fix` repairs only what is safe: duplicate Story Keys, stale Local State,
duplicate Ranks, interrupted commits, leftover temporary files, the `.gitignore`, and
the fixable checks of Plugins that are on (such as unknown Assignees and Task counters).
It reports in `fixed` what it changed and in `findings` what remains. It never deletes a Story or merges
text for you. Run `rowbly doctor --json --no-prompt` again afterwards.
Success: exit 0.

## 3. Repair the rest by hand

For each remaining finding, look up its code in [Finding codes](#finding-codes) below when
`--fix` left it, or when you need to know what a code means. The common ones:

- `CONFLICT_MARKERS`: a file still has `<<<<<<<` / `>>>>>>>` from git, often one Story edited on both
  branches. Open the file, merge the two versions into valid JSON (keep both sides' intended changes),
  and run doctor again.
- `UNKNOWN_STAGE`: a Story is in a Stage that its Board no longer has. Move it with
  `rowbly stories move <KEY> <stage>`. `TASKS_UNKNOWN_STAGE` is the same for a Task: use
  `rowbly tasks move <TASK-ID> <stage>`.
- `SCHEMA_INVALID` / `ID_PATH_MISMATCH`: a file that does not parse or does not match its path. Compare
  it with git (`git diff`, `git log -p -- <path>`) and restore or correct it.
- `MISSING_REQUIRED_FIELD` / `INVALID_FIELD_VALUE`: set a valid value with
  `rowbly stories edit <KEY> --field key=value`.
- `PLUGIN_FAILED`: a Plugin that is on failed to load. `rowbly plugins list --json --no-prompt` shows the
  reason; its data is kept. Do not turn the Plugin off to silence the finding.
- `MULTIPLE_DEFAULT_DATA_ROOTS`: more than one `dataRoots` entry in `~/.rowblyrc.json` is marked
  `"default": true` (`details.defaults` lists them). `--fix` never chooses one. Ask the user which Data
  Root stays the default, then remove `"default": true` from the other entries.

## After a merge with a Story Key conflict

Story Keys have no shared counter. If two branches each created `WEB-7`, git reports an add/add conflict
in `.rowbly/boards/web/stories/WEB-7/story.json`, and every command that reads it exits 6 until it is
fixed. **Do not resolve that file by hand.** Let doctor do it:

```sh
git merge feature/login              # CONFLICT (add/add) in .rowbly/boards/web/stories/WEB-7/story.json
rowbly doctor --json --no-prompt     # STORY_KEY_CONFLICT, fixable; exit 6
rowbly doctor --fix --json --no-prompt
# fixed: kept WEB-7 ("…") and renumbered "…" to WEB-8
rowbly doctor --json --no-prompt     # exit 0
git add .rowbly && git commit        # finish the merge as usual
```

Doctor keeps the earlier-created Story under the key, and gives the other one the next free key. It
moves its folder with its Plugin files; its Task Ids follow the new key. Then update any branch names,
commit messages or notes that used the renumbered key, and tell the user which key changed.

Resolve conflicts in other files under `.rowbly/` (code files are not Rowbly's concern) before or after
running doctor, but run doctor last.

## Common mistakes

- **CRITICAL: deleting a Story folder or `.txn/` to make an error go away.** A Story folder without
  `story.json` still reserves its key, and `.txn/` can hold the only copy of an interrupted commit. Run
  `rowbly doctor --fix`. Rowbly also finishes or rolls back an interrupted commit at the start of its next
  command.
- **HIGH: picking one side of a conflicted `story.json` for a key conflict.** One Story is lost. Use
  `doctor --fix`, which keeps both.
- **HIGH: committing a merge before doctor exits 0.** The conflict reaches everyone who pulls.
- **MEDIUM: `LEGACY_DATA` warnings.** Data from a Rowbly before Plugins (old Comments, `epicId`, Epic
  files) is dropped on the next save of that Story. Commit or back up `.rowbly/` before you change those
  Stories, and tell the user.
- **MEDIUM: a busy lock.** `CONFLICT` (exit 4) naming a lock holder means another Rowbly process is
  running; wait for it and try again. A lock left by a process that has gone is broken by the next
  command, so never delete `.lock` by hand.

## Completion

`rowbly doctor --json --no-prompt` exits 0. Any remaining warnings are understood, and reported to the
user if they need a decision. The merge or repair is committed together with `.rowbly/`.

## Finding codes

Each finding in `rowbly doctor --json` has `code`, `severity`, `path` (relative to `.rowbly/`, or the Home Config's own path), `message`,
`fixable` and sometimes `details.hint`. Follow the hint when there is one.

| Code | Severity | Detects | `--fix` does | Manual repair |
| --- | --- | --- | --- | --- |
| `SCHEMA_INVALID` | error | A file that is not valid JSON, fails its schema, or a required config file that is missing | nothing | Restore or correct the file from git history |
| `ID_PATH_MISMATCH` | error | An id or key inside a file that does not match its folder | nothing | Make the id match the folder, or restore the file |
| `STORY_KEY_CONFLICT` | error | A `story.json` with git conflict markers from two branches that each created the same key | Keeps the earlier Story, gives the later one the next free key | — |
| `DUPLICATE_KEY` | error | Two Story files with the same `key` | Renumbers the Story created later | — |
| `CONFLICT_MARKERS` | error | Conflict markers in any other file, including one Story edited on both branches | nothing | Merge the two versions by hand into valid JSON |
| `DUPLICATE_PREFIX` | error | Two Boards with the same key prefix | nothing | Ask the user which Board keeps the prefix; this needs a manual data change |
| `UNKNOWN_STAGE` | error | A Story in a Stage that its Board does not have | nothing | `rowbly stories move <KEY> <stage>` |
| `UNKNOWN_FIELD` | warning | A Custom Field value with no definition | Strips it | — |
| `INVALID_FIELD_VALUE` | warning | A Custom Field value that does not fit its definition | nothing | `rowbly stories edit <KEY> --field key=value` |
| `MISSING_REQUIRED_FIELD` | warning | A required Custom Field without a value | nothing | `rowbly stories edit <KEY> --field key=value` |
| `DUPLICATE_RANK` | warning | Stories in one Stage with the same Rank | Re-ranks them, keeping the current order | — |
| `STALE_LOCAL_STATE` | warning | `local.json` names a missing Board | Clears it | — |
| `UNKNOWN_FILE` | info | A file outside the Data Root layout | nothing | Remove it if it does not belong there |
| `PLUGIN_FAILED` | error | A Plugin that is on failed to load | nothing | Read the reason in `rowbly plugins list --json`; fix its settings, or turn it off with the user's approval |
| `PLUGIN_DATA_INVALID` | warning | Data of a Plugin that is on that does not match its schema | nothing | Correct the `plugins.<id>` value on that record |
| `PLUGIN_DATA_UNCHECKED` | info | Data of a Plugin that is off or unknown, reported once per Plugin | nothing | None needed |
| `TRANSACTION_PENDING` | error | A commit that was interrupted and could not be completed | Tries the recovery again | If it stays, report it; do not delete `.txn/` |
| `TRANSACTION_LEFTOVER` | warning | A finished or abandoned commit folder in `.txn/` that could not be removed | Removes it | — |
| `TEMP_FILE_LEFTOVER` | warning | A temporary file of an interrupted write, or a `.moving` folder from an older Rowbly | Removes a temporary file; only reports a `.moving` folder | Move that Story's folder back by hand |
| `ORPHAN_FOLDER` | warning | A Board or Story folder with Plugin files but no `board.config.json` / `story.json`. A Story folder still reserves its key | nothing | Restore the missing file from git, or delete the folder with the user's approval |
| `LEGACY_DATA` | warning | Comments, an `epicId`, Story Assignees, Epic files or an Assignee roster from a Rowbly before Plugins. The next save of that Story or `rowbly.config.json` drops them | nothing | Back up first; recreate them with the Assignees, Epics and Comments Plugins |
| `MULTIPLE_DEFAULT_DATA_ROOTS` | error | More than one `dataRoots` entry in `~/.rowblyrc.json` marked `"default": true`, even two naming one folder; `details.defaults` lists each entry's index, path and label | nothing | Ask the user which Data Root stays the default; remove `"default": true` from the others |
| `ASSIGNEES_UNKNOWN_ASSIGNEE` | warning | A Story Assignee that is not in the Assignees Plugin's roster | Removes it | Or add the Assignee: `rowbly assignees add` |
| `ASSIGNEES_UNKNOWN_ME` | warning | The local Me (`local.json`) is not in the Assignees Plugin's roster; global Me is not checked | Clears the local Me | Or add Me: `rowbly assignees add <handle>` |
| `ASSIGNEES_ROSTER_UNAVAILABLE` | error | `plugins/assignees/roster.json` has conflict markers, is not valid JSON or fails its schema | nothing | Merge or correct the file by hand |
| `GITIGNORE_INCOMPLETE` | info | `.rowbly/.gitignore` lacks `local.json`, `.lock`, `.lock.break` or `.txn/` | Adds the missing lines | — |
| `<PLUGIN>_…` (e.g. `EPICS_MISSING_EPIC`, `SPECS_MISSING_SPEC`, `TASKS_UNKNOWN_STAGE`, `TASKS_COUNTER_BEHIND`) | any | Checks of a Plugin that is on | As the Plugin says (`EPICS_MISSING_EPIC` and `SPECS_MISSING_SPEC` unlink the missing target; `TASKS_COUNTER_BEHIND` raises the Story's next Task number; `TASKS_UNKNOWN_STAGE` needs `rowbly tasks move <TASK-ID> <stage>`) | Other Epics file errors (`EPICS_INVALID_JSON`, …) need the Epic file corrected by hand |
