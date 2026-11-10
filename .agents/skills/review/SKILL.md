---
name: review
description: Review the work that the develop skill did for a Rowbly Story, and report if it is ready to merge. Use when a Story is in review or the user asks to review the work of a Story.
---

# Review

This skill examines the pull request of one Story. Do not change the code in this skill.

Read `references/rowbly_reference.md` before you run a `rowbly` command.

## Procedure

1. Read the Project instructions (`rowbly project get-instructions --json`), the Story, its Specs, the repository instructions and the full diff.
2. Examine the code for each acceptance criterion. Do not trust the text of the pull request.
3. Examine the diff for defects, regressions, gaps in the tests and work outside the scope.
4. Read the status of the CI checks. Run the checks of the repository if CI has no result.
5. Make sure that the pull request can merge with no conflicts.

## Result

Report `ready` if all the acceptance criteria are satisfied and you have no blocking findings.

Otherwise, report `changes required` with a numbered list of blocking findings. Give these items for each finding:

- The file and the line.
- The problem.
- The fix that is necessary.

Do not merge the pull request and do not move the Story. The Stage prompt sets the next steps.
