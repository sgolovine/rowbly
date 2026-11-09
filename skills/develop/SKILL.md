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

## Pull request body

Use this format each time that you open a pull request for the Story.

1. Start the body with one short paragraph. Tell the reader what the pull request does and why.
2. Put all other text in one `<details>` block. This text includes the changes, the evidence for each acceptance criterion and the results of the checks.
3. Set the `<summary>` text to your model name. Add your effort level if you know it.
4. Put a blank line after `</summary>`. GitHub does not render the Markdown in the block without this line.

```markdown
ROW-42 lets users filter the story list by stage, because long boards are slow to scan.

<details>
<summary>Claude Opus 5.5 Medium</summary>

## Changes

...

## Evidence

...

## Checks

...

</details>
```

## Result

Report `complete` with the branch name and the evidence for each acceptance criterion.

Report `blocked` with the reason if you cannot complete the work. Do not guess a product decision.

Do not move the Story. The Stage prompt sets the next Stage.
