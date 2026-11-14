Use the `changelog` skill (`.agents/skills/changelog/SKILL.md`) on the pull request in the `pull_request` field of the story.

- If the result is `complete`, move the story to `IN_REVIEW`.
- If the result is `conflicts`, write the conflicts in the `## Review findings` section of the story description. Replace the earlier findings. Move the story to `IN_DEVELOPMENT`.
- If the result is `blocked`, write the blockers in the `## Blockers` section of the story description. Keep the story in this stage.
