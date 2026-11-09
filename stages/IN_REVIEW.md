Use the `review` skill on the pull request in the `pull_request` field of the story.

If the result is `ready`, do these steps:

1. Merge the pull request with a merge commit.
2. Remove the `## Review findings` section from the story description.
3. Move the story to `DONE`.

If the result is `changes required`, do these steps:

1. Write the findings in the `## Review findings` section of the story description. Replace the earlier findings.
2. Move the story to `IN_DEVELOPMENT`.
