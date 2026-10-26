# Context Map

## Contexts

- [Rowbly](./CONTEXT.md) — the core: the Data Root, Boards, Stories, Stages, Me and Plugins
- [Assignees](../../src/plugins/assignees/CONTEXT.md) — a Built-in Plugin that keeps a roster of Assignees and assigns them to Stories
- [Epics](../../src/plugins/epics/CONTEXT.md) — a Built-in Plugin that groups Stories from any Boards
- [Specs](../../src/plugins/specs/CONTEXT.md) — a Built-in Plugin that keeps Spec documents with the Stories and Boards they describe
- [Tasks](../../src/plugins/tasks/CONTEXT.md) — a Built-in Plugin that splits a Story into Tasks, each with its own Stage
- [Comments](../../src/plugins/comments/CONTEXT.md) — a Built-in Plugin that keeps Comments on Stories
- [Story Linking](../../src/plugins/story-linking/CONTEXT.md) — a Built-in Plugin that records blocking relationships between Stories on the same Board
- [Attachments](../../src/plugins/attachments/CONTEXT.md) — a Built-in Plugin that keeps PNG images on Stories
- [Software Factory](../../src/plugins/software-factory/CONTEXT.md) — a Built-in Plugin that gives each Stage a Markdown Stage Prompt for agents

## Relationships

- **Assignees → Rowbly**: a Story's Assignees are Plugin Data on the Story, and its Tasks share them; Me is expected to be an Assignee, which doctor checks
- **Epics → Rowbly**: a Story's Epic is Plugin Data on the Story; Epic Progress is derived from the Stage Categories of the Epic's Stories
- **Specs → Rowbly**: a Story Spec belongs to one Story; a Story's links to Board Specs are Plugin Data on the Story
- **Tasks → Rowbly**: a Story's Tasks are Plugin Data on the Story; a Task's Stage is one of its Board's Stages, and a Task Id starts with its Story's Story Key
- **Comments → Rowbly**: a Story's Thread is Plugin Data on that Story; a Comment's author is Me, or no one (`null`) when Me is not set
- **Story Linking → Rowbly**: outgoing Story links are Plugin Data on the blocking Story; incoming links are derived from the same Board's Stories
- **Attachments → Rowbly**: ordered Attachment entries are Plugin Data on a Story; PNG bytes live in its Plugin folder and move with it when doctor renumbers the Story
- **Software Factory → Rowbly**: a Stage Prompt belongs to one Stage key at the global level or on one Board; its setting is Plugin Data in `rowbly.config.json` or `board.config.json`, a Board's entry for a Stage replaces the global one, and its file lives in the Plugin's folder for that level
- **Rowbly → Plugins**: none. Plugins use core terms; core never uses a Plugin's terms

- [Git](../../src/plugins/git/CONTEXT.md) reacts to saved Operations with Automatic Commits; its personal preferences live in Local State.
