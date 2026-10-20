---
name: rowbly-doctor
description: "Use when a Rowbly Data Root may be inconsistent: after a git
  merge, pull or rebase that touched .rowbly/, when a rowbly command exits 6
  (DATA_INTEGRITY), when two branches created the same Story Key, or when files
  under .rowbly/ were edited by hand. Covers rowbly doctor, doctor --fix, its
  finding codes, and what must be repaired by hand."
metadata:
  purpose: >-
    Guide an agent through checking and repairing a Rowbly Data Root with
    rowbly doctor: after merges, Story Key conflicts, integrity errors and
    interrupted commits, including which findings need a manual fix.
  type: sub-skill
  library: rowbly
  library_version: 0.1.0
requires:
  - rowbly-cli
sources:
  - README.md
  - docs/architecture/data-model.md
  - docs/architecture/storage.md
  - src/commands/doctor.ts
  - src/services/doctor.ts
  - docs/plugins/built-in.md
  - src/services/plugins/git.ts
---

# Check and repair a Rowbly Data Root

Read `rowbly-cli` first.

Run doctor:

- after every git merge, pull or rebase that changed `.rowbly/`;
- when any command exits 6 (`DATA_INTEGRITY`);
- after `rowbly.config.json` or `board.config.json` was edited by hand.

## 1. Check

```sh
rowbly doctor --json --no-prompt
```

The result is a DoctorReport, `{ findings, fixed, summary: { errors, warnings, info } }`. Each finding has a
`code`, a `severity`, a `path` relative to `.rowbly/`, a message, and whether it is fixable. Doctor exits 0
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

For each remaining finding, look up its code in [finding codes](references/finding-codes.md) when
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
- `PLUGIN_FAILED`: see `rowbly plugins list --json --no-prompt` and the `rowbly-plugins` skill.

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
