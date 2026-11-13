---
name: review
description: Review the work that the develop skill did for a Rowbly Story, and report if it is ready to merge. Use when a Story is in review or the user asks to review the work of a Story.
---

# Review

This skill examines the pull request of one Story. Do not change the code in this skill.

Read `references/rowbly-reference.md` before you run a `rowbly` command.

Run each `rowbly` command as `rowbly -C <root> --json ...`.

- A factory worker uses the `<root>` value of its first message.
- Other agents use the main checkout as `<root>`. It is the first entry of `git worktree list`.

## Procedure

1. Read the Project instructions (`rowbly -C <root> --json project get-instructions`), the Story, its Specs and the repository instructions.
2. Find the pull request. See "Find the pull request".
3. Read the full diff.
4. Examine the code for each acceptance criterion. Do not trust the text of the pull request.
5. Examine the diff for defects, regressions, gaps in the tests and work outside the scope.
6. Examine the checks. See "Checks".
7. Make sure that the pull request can merge with no conflicts.
8. Put each finding in one of the two classes of "Findings".

If the Story has `## Review findings` from an earlier review, examine first if each of those findings is repaired.

## Find the pull request

Use the URL in the `pull_request` field of the Story. If the field is empty, do these steps:

1. Run `gh pr list --head story/<story-id> --state all --json url,state`.
2. If the list has a pull request, use it. Write its URL to the Story: `story update <story-id> --field pull_request=<url>`.
3. If the list is empty, report `changes required`. The one finding is that the branch `story/<story-id>` has no pull request.

If the pull request is merged, report `ready`. The Stage prompt then skips the merge.

## Checks

Read the status of the CI checks. Use this table.

| Condition | Action |
| --------- | ------ |
| All checks passed. | Continue. |
| A check still runs. | Read the status again each minute, for a maximum of 15 minutes. Then run the checks of the repository yourself. |
| CI has no result. | Run the checks of the repository yourself, in the worktree of the pull request. |
| A check fails. | Read its log. Then run the same check on the base branch to find the cause. |
| The check also fails on the base branch. | This is not a blocking finding. Write it in your report. |
| The check fails only some of the time. | Run it again one time. If it passes, this is not a finding. |
| The check fails because of the pull request. | This is a blocking finding. |
| You cannot run a check, because a tool or a service is not available. | This is not a blocking finding. Write it in your report. |
| Only a person can examine an acceptance criterion, for example on a device. | Examine the code and the tests for the criterion. If they agree with it, the criterion is satisfied. Write `not verified by a person` in your report. |

Do not write that a check passed if you did not see it pass.

## Findings

A finding is blocking only if one of these conditions is true:

- An acceptance criterion is not satisfied.
- The change breaks behaviour that worked before, loses data or adds a security defect.
- A check fails because of the pull request.
- The pull request has conflicts with the base branch.
- The pull request changes behaviour that the Story does not include.

A separate commit that repairs a check of the base branch is not a blocking finding. The `develop` skill tells the developer to make such a repair, and the pull request lists it in `## Checks`. Examine that the repair does not break other behaviour.

All other findings are not blocking. Examples are names, style, small improvements and tests that are good to have.
Write the findings that are not blocking in one comment on the pull request. They do not change the result.

## Result

Report `ready` if all the acceptance criteria are satisfied and you have no blocking findings.

Otherwise, report `changes required` with a numbered list of blocking findings. Give these items for each finding:

- The file and the line.
- The problem.
- The fix that is necessary.

A factory worker reports `blocked` only in the conditions of its first message. A finding is not a condition for `blocked`.

Do not merge the pull request and do not move the Story. The Stage prompt sets the next steps.
