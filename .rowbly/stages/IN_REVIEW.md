Use the `review` skill (`skills/review/SKILL.md`) on the pull request in the `pull_request` field of the story.

If the result is `ready`, do these steps:

1. Merge the pull request with a merge commit. Skip this step if the pull request is merged.
2. Remove the `## Review findings` section from the story description.
3. Move the story to `DONE`.

If the merge fails, find the cause and do its action:

- The pull request has conflicts with the base branch. Change the result to `changes required`. The finding is the conflict.
- A required check still runs. Wait a maximum of 15 minutes for the check. Then merge again.
- A rule of the repository prevents the merge, for example an approval that only a person can give. The result is `blocked`. Write in the `## Blockers` section of the story description that the pull request is ready and a person must merge it. Keep the story in this stage.

If the result is `changes required`, do these steps:

1. Write the findings in the `## Review findings` section of the story description. Replace the earlier findings.
2. Move the story to `IN_DEVELOPMENT`.
