---
title: Check Story dependencies in rowbly doctor
stage: DONE
position: 45
uid: ac51ba59-4bd5-491c-b6e9-14b432d71466
createdAt: 2026-11-14T23:26:43.000Z
updatedAt: 2026-11-14T23:45:53.000Z
worktree: /home/sgolovine/Projects/rowbly-worktrees/ROW-61
pull_request: https://github.com/sgolovine/rowbly/pull/233
---

## Goal

A git merge or a hand edit can put bad dependencies in the `dependsOn` key of a Story file. Now `rowbly doctor` does not examine `dependsOn`. After this change, `rowbly doctor` finds bad dependencies, and `rowbly doctor --fix` repairs the safe cases.

## Scope

In scope:

- Add `src/services/doctor/story-dependency-checks.ts`. It reports these problems:

| Problem                                                       | Severity | `--fix`                             |
| ------------------------------------------------------------- | -------- | ----------------------------------- |
| `dependsOn` is not a list of strings                          | error    | none                                |
| An ID in a different form (for example `row-1` for `ROW-01`)  | error    | Correct it to the canonical ID      |
| An ID that is not a Story of the Project                      | error    | Remove the ID                       |
| The Story depends on itself                                   | error    | Remove the ID                       |
| The same ID two times                                         | warning  | Remove the duplicate                |
| A cycle                                                       | error    | none; the message names the cycle   |
| An empty `dependsOn` list                                     | warning  | Remove the key                      |

- Report a cycle one time, not one time for each Story in it.
- A cycle has no automatic fix, because only a person can choose the relation to remove. The message names the cycle as `ROW-03 → ROW-01 → ROW-03` and tells the user to run `rowbly story update <id> --remove-dependency <id>`.
- Add `dependsOn` to the known frontmatter keys of the Story check (`unknownKeyIssues` in `src/services/doctor/story-checks.ts`). Without this change, `rowbly doctor` reports `dependsOn` as an unknown custom field, and `--fix` deletes all dependencies.

Not in scope:

- The storage of `dependsOn`, its validation on write and `findCycle` (ROW-59).
- The CLI flags `--depends-on`, `--add-dependency` and `--remove-dependency` (ROW-60). The cycle message only names the command. This Story does not add the flag.
- A check of whether an upstream Story is Complete or Blocked. A Blocked Story is not a doctor problem.

## Acceptance criteria

- [ ] A Story file with a valid `dependsOn` list gives no doctor issue. A test examines that `--fix` does not remove or change the key.
- [ ] Each problem in the table gives the given severity, a message that names the problem, and the file of the Story. A test covers each row.
- [ ] `rowbly doctor --fix` repairs each problem that has a fix in the table. A second run of `rowbly doctor` on the same Project reports no issue for these rows. A test examines the frontmatter after the fix.
- [ ] A fix keeps the other IDs of the list in their order, keeps all other frontmatter keys and keeps the description.
- [ ] A cycle of three Stories (`ROW-01 → ROW-02 → ROW-03 → ROW-01`) gives exactly one error, and `report.ok` is `false`. Two separate cycles give two errors.
- [ ] A `dependsOn` value that is not a list of strings gives one error with no fix, and `--fix` does not change the value.
- [ ] Without `--fix`, no Story file changes. A test examines the bytes of the files.
- [ ] `docs/architecture/storage.md` (section `rowbly doctor`) lists the new checks, in STE.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Technical notes

- Depends on ROW-59. Start the work only after ROW-59 is on the main branch. Read the `story-dependencies` Spec (`.rowbly/specs/story-dependencies.md` in the canonical Project).
- Use `findCycle` from `src/services/story-dependency/story-dependency.ts` (ROW-59). Do not write a second cycle search. To find more than one cycle, call `findCycle` again on a copy of the lists without one relation of each cycle that you reported. Stop when `findCycle` gives nothing.
- Use `canonicalStoryId` (`src/services/spec-files/spec-files.ts`) for the ID form. Do not add a new parse rule. An ID that `canonicalStoryId` cannot parse, or that has a different Project key, is "not a Story of the Project".
- Follow the pattern of `story-field-checks.ts` and `spec-link-checks.ts`: `reportChange` with a `Store<DocRepair>`, `noted` for an issue with no fix, and `withoutKey` to remove the key. Write each changed Story file one time with `writeStoryFile`.
- The checks need the IDs of all Stories, so they cannot run inside `checkStory` alone. Run them in a pass after `checkStories` in `doctor.ts`, with the Story frontmatter after the fixes of `checkStories`. A Story file with invalid frontmatter already has an error. Skip it, and do not stop the run. `readStoryFiles` throws on invalid frontmatter, so do not use it without a guard.
- Order inside one Story: the type check first, then the ID form, unknown IDs, the self reference, duplicates, and then the empty list. The cycle check runs last, over all Stories, on the lists after these fixes. Without `--fix`, the cycle check uses the lists without the IDs that the earlier checks reported.
- The first Story of the cycle that `findCycle` gives is the `file` of the cycle issue.
- Tests go in `src/services/doctor/story-dependency-checks.test.ts` or in `doctor.test.ts`. Use `useTestProject` and write the Story files directly, because the service rejects bad lists on write.
- Obey the `rowbly-code-style` skill. Write the docs in STE.

## Assumptions

- A non-canonical ID (for example `row-1`) gets the fix "Correct it", and is not removed. Reason: `spec-link-checks.ts` uses the same rule for Spec links, and a removal can lose a valid dependency.
- A list that contains a value that is not a string is "not a list of strings", with no fix. Reason: the table of the author gives this problem no fix, and a person must decide about the bad value.
- `dependsOn` must be a known key in `story-checks.ts` in this Story. Reason: ROW-59 does not change doctor, and the unknown-key fix deletes the key.
- The fix of an unknown ID, a self reference and a duplicate removes only that one entry. If the list becomes empty, the empty-list check then removes the key. Reason: this keeps the second run clean.
- Two cycles that share no relation give two errors. Reason: "one time for each cycle" is the intent of the author, and one error for all cycles hides a cycle.
