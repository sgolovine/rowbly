# Rowbly

A developer-focused, file-backed Kanban tracker that runs as a CLI and an interactive terminal UI.

## Language

### Containers

**Data Root**:
The `.rowbly/` directory that holds all Rowbly data (Boards and Plugin data) and top-level configuration, found by walking up from the current directory and falling back to `~/.rowbly`; it is the only container above a Board.
_Avoid_: database, store, repo, workspace, project

**Board**:
A Kanban board inside the Data Root that holds Stories and defines their Stages and Custom Fields, identified by a slug.
_Avoid_: project, list

**ROWBLY.md**:
An optional Markdown file at the top of the Data Root (`.rowbly/ROWBLY.md`) where the people who use it write down how they work with its Boards: what each Stage means, when a Story moves, which Labels and Comments they expect. Rowbly does not read or enforce it; agents read it before they change data and follow it over their own defaults.
_Avoid_: board rules, agent config

### Work items

**Story**:
The main unit of work on a Board, identified by a Story Key and placed in exactly one Stage; a Story never moves to another Board.
_Avoid_: issue, ticket, card

**Story Key**:
The permanent, human-typeable identifier of a Story, made of its Board's key prefix and a sequence number (for example `WEB-42`).
_Avoid_: story id, story slug

**Priority**:
A Story's urgency on the fixed scale `P0` (most urgent) to `P4`, or none.
_Avoid_: severity, importance

**Label**:
A free-form lower-kebab-case tag on a Story.
_Avoid_: tag, category

### Board configuration

**Stage**:
One of the ordered statuses a Story can be in, belonging to exactly one Stage Category. Every Board starts with the fixed Backlog Stage and ends with the fixed Done Stage; the Stages between them are configured per Board. Plugins may give their own records a Stage too.
_Avoid_: status, column, state, lane

**Stage Category**:
The fixed meaning of a Stage across all Boards: `backlog` (only the Backlog Stage), `board` (every configured Stage) or `done` (only the Done Stage).
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

**Me**:
The handle the local developer has claimed with `rowbly whoami`, recorded as a Story's creator and used by Plugins that record who did something. It is the **local Me** in Local State when the Data Root has one, else **global Me** in the Home Config.
_Avoid_: current user, login

**Local State**:
Per-developer, never-committed settings in the Data Root (current Board and the local Me).
_Avoid_: session, profile

**Home Config**:
Per-user settings shared by every Data Root on the machine, in `~/.rowblyrc.json` (a global Me and the known Data Roots).
_Avoid_: rc file, global config, user profile

### Changes

**Operation**:
One named change to the Data Root (for example `stories.create`), from core or from a Plugin, that fills one Change Set and saves it once; Plugins hook Operations by name.
_Avoid_: action, event, request

**Change Set**:
The records and Plugin files an Operation creates, changes or deletes, each with its version before and after, saved together or not at all.
_Avoid_: diff, batch

### Plugins

**Plugin**:
An optional, self-contained feature that adds to or changes what Rowbly does, turned on for a whole Data Root.
_Avoid_: extension, add-on, module

**Built-in Plugin**:
A Plugin that ships as part of Rowbly itself.
_Avoid_: first-party plugin, official plugin, core plugin

**Plugin Data**:
The values a Plugin keeps under its own name on the Data Root, a Board or a Story, or in Local State; Rowbly keeps them unchanged while that Plugin is off.
_Avoid_: custom data, extension data

**Action**:
A key, with a matching button, that a Plugin adds to the TUI wherever the Board or Story it acts on is in focus; an Action that acts on no particular record shows on every screen.
_Avoid_: button, shortcut, hotkey

**Plugin Sidebar**:
A list a Plugin adds beside the Board sidebar in the TUI, shown with its header button; picking an entry filters the board by that Plugin's filter.
_Avoid_: side panel, drawer
