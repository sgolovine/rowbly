# WP10 — Doctor

**Depends on:** WP05, WP06, WP07 · **Phase:** 3

## Goal

`rowbly doctor` validates the whole Data Root. `--fix` repairs the problems that can be fixed safely, mainly the damage that git merges cause in a file-backed tracker (ADR-0003).

## Owns

- Service: `src/services/doctor.ts`.
- Command: `src/commands/doctor.ts`.
- A doctor screen: `src/tui/screens/doctor/**` (reachable from the `g` palette).
- README section `doctor`.
- Tests for all of the above.

## Checks (each finding has a severity, path, code, message and fixable flag)

| Code | Severity | Detects | `--fix` |
| --- | --- | --- | --- |
| `SCHEMA_INVALID` | error | A file that fails its schema or isn't valid JSON | — (report the zod issues) |
| `ID_PATH_MISMATCH` | error | The id or key inside a file doesn't match its path | — |
| `STORY_KEY_CONFLICT` | error | A story file has git conflict markers and both sides parse as Stories with the same key (an add/add merge of two new stories) | Keep the side with the earlier `createdAt` under the key, give the other side the next free key on the board, write both files, and report the renumbering |
| `DUPLICATE_KEY` | error | Two story files whose `key` fields are equal | Renumber the story created later to the next free key |
| `CONFLICT_MARKERS` | error | Conflict markers in any other file | — (report which file and suggest a manual merge) |
| `DUPLICATE_PREFIX` | error | Two boards share a key prefix | — |
| `UNKNOWN_STAGE` | error | A story or task stage isn't in the effective stages | — (suggest `stories move`) |
| `UNKNOWN_ASSIGNEE` | warning | A handle isn't in the roster | Remove it |
| `MISSING_EPIC` | warning | `epicId` refers to an epic that doesn't exist | Set it to `null` |
| `UNKNOWN_FIELD` / `INVALID_FIELD_VALUE` | warning | A custom field value doesn't match the effective field definitions | Strip unknown fields. Invalid values are only reported. |
| `MISSING_REQUIRED_FIELD` | warning | A required field has no value | — |
| `TASK_COUNTER_BEHIND` | warning | `nextTaskNumber` is ≤ the highest task number | Set it to max + 1 |
| `DUPLICATE_RANK` | warning | Two stories in the same stage have equal ranks | Re-rank that stage, keeping the current order |
| `STALE_LOCAL_STATE` | warning | `local.json` points at a workspace, board or Me that is missing | Clear the stale entries |
| `UNKNOWN_FILE` | info | A file isn't in the layout | — |

## Output

- Human mode prints findings grouped by severity, a summary line, and a hint when fixable findings exist.
- `--json` prints a `DoctorReport` containing `{ findings, fixed, summary }`.
- The exit code is 0 when there are no errors, and 6 when errors remain (after fixes, if `--fix` was given).

## Acceptance criteria

- [ ] A test builds a real add/add conflict: two git branches in a temp repo each create `WEB-4`, then they are merged. `doctor` reports `STORY_KEY_CONFLICT`. `doctor --fix` leaves `WEB-4` (the earlier story) and `WEB-5`, both valid. A second `doctor` run exits 0.
- [ ] Each fixable code has a test showing the fix, and that running it again is a no-op.
- [ ] A Data Root with no issues prints "No problems found" and exits 0.
- [ ] `--json` output validates against the `DoctorReport` type.
