---
name: develop
description: Develop a refined Rowbly Story in a Git worktree, or fix the findings of a review. Use when a Story is in development or the user asks to develop a Story.
---

# Develop

This skill builds the work of one refined Story in a linked Git worktree and commits it to a branch.

Read `references/rowbly-reference.md` before you run a `rowbly` command.

## Project and Story fields

Run each `rowbly` command as `rowbly -C <root> --json ...`.

- A factory worker uses the `<root>` value of its first message.
- Other agents use the main checkout as `<root>`. It is the first entry of `git worktree list`.

Do not run `rowbly` in a linked worktree without `-C <root>`. The worktree has its own copy of `.rowbly/`.

The skill uses these custom fields:

| Key            | Type     | Value                                       |
| -------------- | -------- | ------------------------------------------- |
| `worktree`     | `string` | The absolute path of the linked worktree    |
| `pull_request` | `url`    | The URL of the GitHub pull request          |

If the config does not have a field, add it. Do not stop.

```sh
rowbly -C <root> --json custom-field add --label "Worktree" --type string --key worktree
rowbly -C <root> --json custom-field add --label "Pull request" --type url --key pull_request
```

If a command gives `CONFLICT`, the field exists. Continue.

## Procedure

1. Read the Project instructions (`rowbly -C <root> --json project get-instructions`), the Story and its Specs.
2. If the Story has no acceptance criteria or has open questions, do "A Story that is not refined".
3. Read the repository instructions and obey them.
4. Select the branch:
   - If the `pull_request` field has a pull request, use the branch of that pull request.
   - Otherwise, use the branch `story/<story-id>` from the base branch.
   - If the branch exists, use it. It holds the work of an earlier worker. Continue from that work.
5. Get a linked worktree. Do not do the work in the main checkout.
   - If the `worktree` field has the path of a linked worktree that exists, use that worktree.
   - If the harness started you in a linked worktree, use that worktree. Switch it to the branch.
   - Otherwise, run `git worktree add` for the branch. Use the path `<main checkout>-worktrees/<story-id>`.
   - If Git says that a different worktree has the branch, use that worktree.
6. Write the absolute path of the worktree to the Story: `story update <story-id> --field worktree=<path>`.
7. Make only the changes that the Story describes. If the Story has `## Review findings`, repair each finding.
   The only other changes are the repairs that "Checks" tells you to make.
8. Add or update the tests for each acceptance criterion.
9. Run the checks of the repository in the worktree. See "Checks".
10. Commit the changes.

## A Story that is not refined

If a person started you and answers in this conversation, ask the person for the missing information.

A factory worker does not ask and does not stop. It does these steps:

1. Write the acceptance criteria from the goal of the Story and the existing code.
2. Make a decision for each open question. Select the most simple option that agrees with the Story.
3. Write each decision and its reason in the `## Assumptions` section of the Story.
4. Save the description with `story update`. Then continue the procedure.

## Checks

Run each check that the repository instructions name. Use this table for each check that does not pass.

| Condition | Action |
| --------- | ------ |
| The check fails because of your changes. | Repair your changes. Run the check again. |
| The check fails, and you do not know the cause. | Run the same check on the base branch, for example in a temporary worktree. |
| The check also fails on the base branch. | Repair the cause in a separate commit, also if the cause is outside the scope of the Story. Start the commit message with `fix(checks):`. List the commit in `## Checks` of the pull request. |
| The check also fails on the base branch, and you cannot repair it. | Record the check as `fails on the base branch`. Continue. |
| A test fails only some of the time. | Run only that test again. If it passes, record it as `flaky`. Continue. |
| The check cannot run, because a tool, a dependency or a service is not available. | Install the dependencies as the repository instructions specify. If it still cannot run, record the check as `not run`, with the reason. Continue. |
| Only a person can examine an acceptance criterion, for example on a device. | Do the nearest automatic check. Record the criterion as `not verified by an agent`, with the reason. Continue. |

Obey these rules:

- A check that fails is not a reason to stop. Repair it, or record it and continue.
- Do not write that a check passed if you did not see it pass.
- Do not remove or weaken a test to make it pass. Change a test only if the Story changes the behaviour that it examines.
- If a repair command changes the `.rowbly/` copy of the worktree, restore that copy with `git checkout -- .rowbly`.
- Record each check that did not pass in the `## Checks` section of the pull request, with its condition from the table.

If a check still fails because of your changes after 5 repairs, do these steps:

1. Commit the work and push the branch, so that the next worker can continue from it.
2. Write the failure, the repairs that you tried and your best idea of the cause in `## Blockers` of the Story.
3. Report `blocked`.

## Pull request

Set the title of each new Story pull request to `<Story ID>: <summary>`.
Use the full `id` from `story get`, then a colon, a space and a short summary.
Use the current Story ID for each pull request.

Example: `ROW-07: Include Story IDs in pull request titles`.

Write the URL to the Story immediately after you open a pull request: `story update <story-id> --field pull_request=<url>`.

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

Report `complete` with the branch name, the worktree path, the evidence for each acceptance criterion and each check that did not pass.
The result is `complete` also when you recorded a check as `fails on the base branch`, `flaky`, `not run` or `not verified by an agent`.

Report `blocked` only in these conditions:

- A check still fails because of your changes after 5 repairs.
- A factory worker has a condition for `blocked` from its first message.
- A person started you, and the person must make a product decision that you cannot make.

Before you report `blocked`, write the `## Blockers` section in the Story description: the problem, the methods that you tried and the action that a person must do.

Do not move the Story. The Stage prompt sets the next Stage.
