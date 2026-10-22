# Doctor finding codes

Each finding in `rowbly doctor --json` has `code`, `severity`, `path` (relative to `.rowbly/`), `message`,
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
| `ASSIGNEES_UNKNOWN_ASSIGNEE` | warning | A Story Assignee that is not in the Assignees Plugin's roster | Removes it | Or add the Assignee: `rowbly assignees add` |
| `ASSIGNEES_UNKNOWN_ME` | warning | The local Me (`local.json`) is not in the Assignees Plugin's roster; global Me is not checked | Clears the local Me | Or add Me: `rowbly assignees add <handle>` |
| `ASSIGNEES_ROSTER_UNAVAILABLE` | error | `plugins/assignees/roster.json` has conflict markers, is not valid JSON or fails its schema | nothing | Merge or correct the file by hand |
| `GITIGNORE_INCOMPLETE` | info | `.rowbly/.gitignore` lacks `local.json`, `.lock`, `.lock.break` or `.txn/` | Adds the missing lines | — |
| `<PLUGIN>_…` (e.g. `EPICS_MISSING_EPIC`, `SPECS_MISSING_SPEC`, `TASKS_UNKNOWN_STAGE`, `TASKS_COUNTER_BEHIND`) | any | Checks of a Plugin that is on | As the Plugin says (`EPICS_MISSING_EPIC` and `SPECS_MISSING_SPEC` unlink the missing target; `TASKS_COUNTER_BEHIND` raises the Story's next Task number; `TASKS_UNKNOWN_STAGE` needs `rowbly tasks move <TASK-ID> <stage>`) | Other Epics file errors (`EPICS_INVALID_JSON`, …) need the Epic file corrected by hand |
