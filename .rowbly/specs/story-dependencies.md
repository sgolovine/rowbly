---
title: Story dependencies
stories:
  - ROW-59
  - ROW-60
  - ROW-61
  - ROW-62
  - ROW-63
  - ROW-64
  - ROW-65
  - ROW-66
---

# Story dependencies

## Problem

Some Stories cannot start before other Stories are complete. For example:

| Story | Title                                | Depends on |
| ----- | ------------------------------------ | ---------- |
| 01    | Initialize the website with React    | none       |
| 02    | Initialize Tailwind CSS              | none       |
| 03    | Build the header                     | 01, 02     |
| 04    | Initialize the email framework       | none       |
| 05    | Build the contact page               | 04         |

Now Rowbly has no record of these relations. The factory can start a worker for Story 03 before the
code of Story 01 and Story 02 is on the main branch. That worker then does the upstream work again, or
it fails.

## Goal

A Story can depend on other Stories of the same Project. The factory does not start a worker for a
Story until all of its upstream Stories are complete. When worker slots are few, the factory starts the
upstream Stories first.

## Words

| Word              | Meaning                                                                              |
| ----------------- | ------------------------------------------------------------------------------------ |
| Dependency        | A relation: Story B depends on Story A.                                              |
| Upstream Story    | Story A. It must be complete before Story B can start.                               |
| Downstream Story  | Story B. It waits for Story A.                                                       |
| Complete          | The Story is in the last Stage of the board (the `done` Stage Category).             |
| Blocked           | The Story has one or more upstream Stories that are not complete.                    |
| Ready             | The Story has no upstream Stories, or all of them are complete.                      |

Use these words in code, CLI text, TUI text and documentation.

## Rules

### Storage

- A Story keeps its upstream Stories in the frontmatter key `dependsOn`, a list of Story IDs:
  `dependsOn: [ROW-01, ROW-02]`.
- Only the downstream Story keeps the relation. The services calculate the reverse list (`blocks`).
  Thus one relation is in one file only, and a git merge cannot give two different copies.
- A Story without dependencies has no `dependsOn` key. Existing Story files do not change.
- `dependsOn` comes after `position` and before the custom fields. A custom field cannot have this key,
  because a custom field key has only lower-case letters, digits and `_`.

### Validation on each write

- Each ID must be the ID of a Story that exists in the same Project.
- A Story cannot depend on itself.
- A change cannot make a cycle (A → B → A, or a longer cycle). The error names the cycle, for example
  `ROW-03 → ROW-01 → ROW-03`.
- The service removes duplicates and keeps the order that the user gave.
- An error is a `ValidationError` with `details`. Nothing is saved.

### Delete

- When a user deletes an upstream Story, the service removes its ID from the `dependsOn` list of each
  downstream Story, in the same write. The result has a warning for each changed Story.

### Complete

- An upstream Story is complete only in the last Stage. A Story in review is not complete, because the
  worktree of a downstream worker starts from the main branch. The upstream code is on the main branch
  only after the merge.
- If an upstream Story goes back from the last Stage, its downstream Stories are blocked again. The
  factory does not stop a worker that runs. It only does not start a new one.

### Factory

- The policy (`factory-policy/`) skips a blocked Story in a work Stage with the reason
  `waiting for <IDs>`. The decision lists the IDs.
- A blocked Story uses no attempt budget and is never parked because it is blocked.
- `start_worker` refuses a blocked Story, also when the supervisor asks for it.
- The gate applies in all work Stages, also in a refinement Stage. Backlog and Done get no workers
  before this change and after it.
- When the worker limit applies, the order of the launches is: the Stage nearest to the last Stage
  first, then the Stories with more blocked downstream Stories, then the order of the board.
- If an upstream Story of a blocked Story cannot progress (it is in the first Stage, it is parked, or a
  hold Stage holds it), the supervisor raises attention once for each upstream Story.

## Out of scope

- Dependencies between Projects.
- A per-Stage setting that lets a blocked Story enter some Stages.
- Other relation types, for example "relates to" or "duplicates".

## Stories

The Stories of this Spec have dependencies of their own:

| Story  | Depends on      |
| ------ | --------------- |
| ROW-59 | none            |
| ROW-60 | ROW-59          |
| ROW-61 | ROW-59          |
| ROW-62 | ROW-59          |
| ROW-63 | ROW-62          |
| ROW-64 | ROW-59          |
| ROW-65 | ROW-60, ROW-62  |
| ROW-66 | ROW-63          |

When ROW-59 and ROW-60 are complete, record these relations with `rowbly story update --depends-on`.
