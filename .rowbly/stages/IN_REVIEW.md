Use the `review` skill (`.agents/skills/review/SKILL.md`) on the pull request in the `pull_request` field of the story.

If the result is `ready`, do these steps:

1. If the pull request is not merged, make sure that it adds a line that ends with `(<story-id>)` to the `### Pre Release` section of `CHANGELOG.md`. If it does not, move the story to `CHANGELOG` and do not do the other steps.
2. Merge the pull request with a merge commit. Skip this step if the pull request is merged.
3. Remove the `## Review findings` section from the story description.
4. Move the story to `DONE`.

If the merge fails, find the cause and do its action:

- The pull request has conflicts only in `CHANGELOG.md`. Move the story to `CHANGELOG`. That stage merges the base branch and writes the entry again.
- The pull request has conflicts in other files. Change the result to `changes required`. The finding is the conflict.
- A required check still runs. Wait a maximum of 15 minutes for the check. Then merge again.
- A rule of the repository prevents the merge, for example an approval that only a person can give. The result is `blocked`. Write in the `## Blockers` section of the story description that the pull request is ready and a person must merge it. Keep the story in this stage.

The `CHANGELOG.md` entry of the story is a part of the work. It is not a change outside the scope of the story.

If the result is `changes required` and the only blocking finding is a conflict in `CHANGELOG.md`, move the story to `CHANGELOG`. Do not do the steps below.

If the result is `changes required`, do these steps:

1. Write the findings in the `## Review findings` section of the story description. Replace the earlier findings.
2. Move the story to `IN_DEVELOPMENT`.
