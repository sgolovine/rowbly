# Rowbly

A developer-focused, file-backed Kanban tracker that runs as a CLI and an interactive terminal UI.

## Language

### Containers

**Data Root**:
The `.rowbly/` directory that holds all Rowbly data (Boards and the Assignee roster) and top-level configuration, found by walking up from the current directory and falling back to `~/.rowbly`; it is the only container above a Board.
_Avoid_: database, store, repo, workspace, project

**Board**:
A Kanban board inside the Data Root that holds Stories and defines their Stages and Custom Fields, identified by a slug.
_Avoid_: project, list

### Work items

**Story**:
The main unit of work on a Board, identified by a Story Key and placed in exactly one Stage; a Story never moves to another Board.
_Avoid_: issue, ticket, card

**Story Key**:
The permanent, human-typeable identifier of a Story, made of its Board's key prefix and a sequence number (for example `WEB-42`).
_Avoid_: story id, story slug

**Task**:
A smaller unit of work inside exactly one Story, with its own title, description, Stage and Comments; it has no Assignees of its own and belongs to the Story's Assignees.
_Avoid_: sub-task, subtask, checklist item

**Priority**:
A Story's urgency on the fixed scale `P0` (most urgent) to `P4`, or none.
_Avoid_: severity, importance

**Label**:
A free-form lower-kebab-case tag on a Story.
_Avoid_: tag, category

**Comment**:
A note attached to a Story or a Task.
_Avoid_: reply, note

### Board configuration

**Stage**:
One of the ordered statuses a Story or Task can be in, configured per Board and belonging to exactly one Stage Category.
_Avoid_: status, column, state, lane

**Stage Category**:
The fixed meaning of a Stage across all Boards: `todo`, `in_progress` or `done`.
_Avoid_: status type, stage group

**Configuration Cascade**:
The chain of global (`rowbly.config.json`) and Board (`board.config.json`) configuration, where the most specific level that defines Stages or Custom Fields replaces the levels above it.
_Avoid_: inheritance, overrides

**Rank**:
A Story's manual position within its Stage.
_Avoid_: order, priority, position

**Custom Field**:
A board-configured attribute that every Story on that Board can carry a value for.
_Avoid_: property, attribute, metadata

### People

**Assignee**:
A person in the Data Root's roster (in `rowbly.config.json`) who can be assigned to Stories; a Story has zero or more Assignees.
_Avoid_: user, owner, member

**Me**:
The Assignee handle the local developer has claimed with `rowbly whoami`, used as Comment author and Story creator.
_Avoid_: current user, login

**Local State**:
Per-developer, never-committed settings in the Data Root (current Board and Me).
_Avoid_: session, profile

### Plugins

**Plugin**:
An optional, self-contained feature that adds to or changes what Rowbly does, turned on for a whole Data Root.
_Avoid_: extension, add-on, module

**Built-in Plugin**:
A Plugin that ships as part of Rowbly itself.
_Avoid_: first-party plugin, official plugin, core plugin

**Plugin Data**:
The values a Plugin keeps under its own name on the Data Root, a Board, Story, Task, Comment or Assignee, or in Local State; Rowbly keeps them unchanged while that Plugin is off.
_Avoid_: custom data, extension data

**Action**:
A key, with a matching button, that a Plugin adds to the TUI wherever the Board, Story or Task it acts on is in focus.
_Avoid_: button, shortcut, hotkey
