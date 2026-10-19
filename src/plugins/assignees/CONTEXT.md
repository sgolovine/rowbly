# Assignees

A Built-in Plugin that keeps a roster of people and assigns them to Stories.

## Language

**Assignee**:
A person in the Data Root's roster (`plugins/assignees/roster.json`), identified by a handle, who can be assigned to Stories; a Story has zero or more Assignees, and its Tasks share them.
_Avoid_: user, owner, member

**Roster**:
Every Assignee of the Data Root, in the order they were added.
_Avoid_: team, people, members
