# ADR-0004: The Story holds the Epic link

**Status:** Superseded by [ADR-0008](0008-no-epics.md). [ADR-0014](0014-epics-return-as-a-built-in-plugin.md) later kept the Epic link on the Story, as Plugin Data.

Each story has an optional `epicId` field. An epic's list of stories is worked out by scanning stories, so the epic file does not store `storyIds[]`. This is different from the early architecture draft, which said epics are linked to story IDs. With the link on the story, moving a story into or out of an epic changes only that story's file, so there is no shared epic file for people to conflict on in git.
