---
name: develop
description: Develop a refined Rowbly Story on a Git branch, or fix the findings of a review. Use when a Story is in development or the user asks to develop a Story.
---

# Develop

This skill builds the work of one refined Story and commits it to a branch.

Read `references/rowbly_reference.md` before you run a `rowbly` command.

## Procedure

1. Read the Project instructions (`rowbly get-instructions --json`), the Story and its Specs.
2. Stop and report `blocked` if the Story has no acceptance criteria or has open questions.
3. Read the repository instructions and obey them.
4. Select the branch:
   - If the Story has `## Review findings`, use the branch of its pull request.
   - Otherwise, create the branch `story/<story-id>` from the base branch.
5. Make only the changes that the Story describes. If the Story has `## Review findings`, repair each finding.
6. Add or update the tests for each acceptance criterion.
7. Run the checks of the repository and repair each failure.
8. Commit the changes.

## Result

Report `complete` with the branch name and the evidence for each acceptance criterion.

Report `blocked` with the reason if you cannot complete the work. Do not guess a product decision.

Do not move the Story. The Stage prompt sets the next Stage.
