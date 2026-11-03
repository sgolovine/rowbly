# Story Linking

A Built-in Plugin that records blocking relationships between Stories on one Board.

**Story link**:
A directed relationship: one Story **blocks** another Story, and the other is **blocked by** it.
Each link is kept on the blocking Story; the reciprocal view is derived from the Board's Stories.
A Story can have any number of links in either direction. Links do not change a Story's Stage.
_Avoid_: dependency graph, prerequisite

The public Story filter `{ blocks: Story Key }` returns blocking Stories through the Plugin API,
with strict query and bag validation. The Software Factory uses it for eligibility. Story Linking's
`software-factory.start` guard rejects unfinished blockers in the final pending Story state; only a
Stage of category `done` resolves one. Links still do not restrict manual Stage changes.
