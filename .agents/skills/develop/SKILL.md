---
name: develop
description: Develop a refined Rowbly Story in a Git worktree, or fix the findings of a review. Use when a Story is in development or the user asks to develop a Story.
---

# Develop

This skill builds the work of one refined Story in a linked Git worktree and commits it to a branch.

Read `references/rowbly_reference.md` before you run a `rowbly` command.

## Project and Story fields

Run each `rowbly` command as `rowbly -C <root> --json ...`.

- A factory worker uses the `<root>` value of its first message.
- Other agents use the main checkout as `<root>`. It is the first entry of `git worktree list`.

Do not run `rowbly` in a linked worktree without `-C <root>`. The worktree has its own copy of `.rowbly/`.

The Project must have these custom fields:

| Key            | Type     | Value                                       |
| -------------- | -------- | ------------------------------------------- |
| `worktree`     | `string` | The absolute path of the linked worktree    |
| `pull_request` | `url`    | The URL of the GitHub pull request          |

## Procedure

1. Read the Project instructions (`rowbly -C <root> --json get-instructions`), the Story and its Specs.
2. Stop and report `blocked` if the Story has no acceptance criteria or has open questions.
3. Stop and report `blocked` if the config does not have the two custom fields.
4. Read the repository instructions and obey them.
5. Select the branch:
   - If the Story has `## Review findings`, use the branch of the pull request in the `pull_request` field.
   - Otherwise, use the new branch `story/<story-id>` from the base branch.
6. Get a linked worktree. Do not do the work in the main checkout.
   - If the `worktree` field has the path of a linked worktree that exists, use that worktree.
   - If the harness started you in a linked worktree, use that worktree. Switch it to the branch.
   - Otherwise, run `git worktree add` for the branch. Use the path `<main checkout>-worktrees/<story-id>`.
7. Write the absolute path of the worktree to the Story: `update-story <story-id> --field worktree=<path>`.
8. Make only the changes that the Story describes. If the Story has `## Review findings`, repair each finding.
9. Add or update the tests for each acceptance criterion.
10. Run the checks of the repository in the worktree and repair each failure.
11. Commit the changes.

## Pull request

Set the title of each new Story pull request to `<Story ID>: <summary>`.
Use the full `id` from `get-story`, then a colon, a space and a short summary.
Use the current Story ID for each pull request.

Example: `ROW-07: Include Story IDs in pull request titles`.

Write the URL to the Story immediately after you open a pull request: `update-story <story-id> --field pull_request=<url>`.

If the branch has a pull request and the `pull_request` field is empty, write the URL to the Story.

Use the format below each time that you open a pull request for the Story.

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

Report `complete` with the branch name, the worktree path and the evidence for each acceptance criterion.

Report `blocked` with the reason if you cannot complete the work. Do not guess a product decision.

Do not move the Story. The Stage prompt sets the next Stage.
