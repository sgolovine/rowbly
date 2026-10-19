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
| `UNKNOWN_STAGE` | error | A Story or Task in a Stage that its Board does not have | nothing | `rowbly stories move <KEY> <stage>` / `rowbly tasks move <TASK-ID> <stage>` |
| `UNKNOWN_ASSIGNEE` | warning | A Story Assignee that is not in the roster | Removes it | Or add the Assignee: `rowbly assignees add` |
| `UNKNOWN_FIELD` | warning | A Custom Field value with no definition | Strips it | — |
| `INVALID_FIELD_VALUE` | warning | A Custom Field value that does not fit its definition | nothing | `rowbly stories edit <KEY> --field key=value` |
| `MISSING_REQUIRED_FIELD` | warning | A required Custom Field without a value | nothing | `rowbly stories edit <KEY> --field key=value` |
| `TASK_COUNTER_BEHIND` | warning | `nextTaskNumber` at or below the highest Task number | Sets it to the highest + 1 | — |
| `DUPLICATE_RANK` | warning | Stories in one Stage with the same Rank | Re-ranks them, keeping the current order | — |
| `STALE_LOCAL_STATE` | warning | `local.json` names a missing Board, or a Me not in the roster | Clears those entries | — |
| `UNKNOWN_FILE` | info | A file outside the Data Root layout | nothing | Remove it if it does not belong there |
| `PLUGIN_FAILED` | error | A Plugin that is on failed to load | nothing | Read the reason in `rowbly plugins list --json`; fix its settings, or turn it off with the user's approval |
| `PLUGIN_DATA_INVALID` | warning | Data of a Plugin that is on that does not match its schema | nothing | Correct the `plugins.<id>` value on that record |
| `PLUGIN_DATA_UNCHECKED` | info | Data of a Plugin that is off or unknown, reported once per Plugin | nothing | None needed |
| `TRANSACTION_PENDING` | error | A commit that was interrupted and could not be completed | Tries the recovery again | If it stays, report it; do not delete `.txn/` |
| `TRANSACTION_LEFTOVER` | warning | A finished or abandoned commit folder in `.txn/` that could not be removed | Removes it | — |
| `TEMP_FILE_LEFTOVER` | warning | A temporary file of an interrupted write, or a `.moving` folder from an older Rowbly | Removes a temporary file; only reports a `.moving` folder | Move that Story's folder back by hand |
| `ORPHAN_FOLDER` | warning | A Board or Story folder with Plugin files but no `board.config.json` / `story.json`. A Story folder still reserves its key | nothing | Restore the missing file from git, or delete the folder with the user's approval |
| `LEGACY_DATA` | warning | Comments, an `epicId` or Epic files from a Rowbly before Plugins. The next save of that Story drops them | nothing | Back up first; recreate them with the Epics and Comments Plugins |
| `GITIGNORE_INCOMPLETE` | info | `.rowbly/.gitignore` lacks `local.json`, `.lock`, `.lock.break` or `.txn/` | Adds the missing lines | — |
| `<PLUGIN>_…` (e.g. `EPICS_MISSING_EPIC`, `SPECS_MISSING_SPEC`) | any | Checks of a Plugin that is on | As the Plugin says (`EPICS_MISSING_EPIC` and `SPECS_MISSING_SPEC` unlink the missing target) | Other Epics file errors (`EPICS_INVALID_JSON`, …) need the Epic file corrected by hand |
