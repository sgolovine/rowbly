# ADR-0003: Stories are identified by sequential keys

**Status:** Accepted. Amended narrowly by [ADR-0034](0034-git-synchronization-publishes-recoverably.md).

Boards and Epics are identified by their slugs. Stories are identified by a Story Key, such as `WEB-42`. The key is made of the Board's key prefix and a number, and it is also the story's filename. When you rename a story, its file is not renamed. Developers can type the key directly in commands, branch names and commit messages.

We did not use generated IDs, because they are hard to type. We did not use slugs of story names, because names change.

To get the next number, Rowbly scans the board's story files and adds one to the highest number. It does not keep a counter file, because a shared counter would cause a merge conflict every time two branches create stories. As a result, two branches can create the same key, and `rowbly doctor` finds these collisions and repairs them. A deleted story's key can also be used again: if the highest-numbered story is deleted, the next new story gets its number. We accept this because stories are rarely deleted, and git history shows which story a key meant at a given time.
