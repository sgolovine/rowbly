# The Story holds the Epic link

Each story has an optional `epicId` field. An epic's list of stories is worked out by scanning stories, so the epic file does not store `storyIds[]`. This is different from `ARCHITECTURE.md`, which said epics are linked to story IDs. With the link on the story, moving a story into or out of an epic changes only that story's file, so there is no shared epic file for people to conflict on in git.
