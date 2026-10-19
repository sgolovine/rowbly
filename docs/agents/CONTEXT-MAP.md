# Context Map

## Contexts

- [Rowbly](./CONTEXT.md) — the core: the Data Root, Boards, Stories, Tasks, Stages, Me and Plugins
- [Assignees](../../src/plugins/assignees/CONTEXT.md) — a Built-in Plugin that keeps a roster of Assignees and assigns them to Stories
- [Epics](../../src/plugins/epics/CONTEXT.md) — a Built-in Plugin that groups Stories from any Boards
- [Specs](../../src/plugins/specs/CONTEXT.md) — a Built-in Plugin that keeps Spec documents with the Stories and Boards they describe
- [Comments](../../src/plugins/comments/CONTEXT.md) — a Built-in Plugin that keeps Comments on Stories and Tasks

## Relationships

- **Assignees → Rowbly**: a Story's Assignees are Plugin Data on the Story, and its Tasks share them; Me is expected to be an Assignee, which doctor checks
- **Epics → Rowbly**: a Story's Epic is Plugin Data on the Story; Epic Progress is derived from the Stage Categories of the Epic's Stories
- **Specs → Rowbly**: a Story Spec belongs to one Story; a Story's links to Board Specs are Plugin Data on the Story
- **Comments → Rowbly**: a Story's or Task's Thread is Plugin Data on that Story or Task; a Comment's author is Me, or no one (`null`) when Me is not set
- **Rowbly → Plugins**: none. Plugins use core terms; core never uses a Plugin's terms
