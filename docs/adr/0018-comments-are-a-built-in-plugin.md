# Comments are a Built-in Plugin

Comments were part of core: a `comments` array on every Story and Task, a Comments service, the `rowbly comments` commands and a Comments tab on the Story and Task screens. Not every team wants a discussion inside its tracker, and Comments did not need anything that a Plugin cannot have, so they move into the Comments Built-in Plugin, like Epics (ADR-0014). Core no longer has a Comment schema, a Comments service or `comments.*` core operations, and no Comment code outside `src/plugins/comments/`.

A Story's or Task's Comments are Plugin Data on that Story or Task (ADR-0011), as `"plugins": { "comments": { "comments": [ … ] } }`. Tasks have no folder (ADR-0013), so a bag is the only place for a Task's Comments, and Story Comments use the same shape. The Plugin's operations keep the old names, `comments.add`, `comments.update` and `comments.remove`, and the commands keep their flags and output. Comments no longer carry bags of their own.

The Plugin API gains what the move needed: tabs on the Task screen (`taskTabs`), rows for `tasks show` and the Task screen (`taskRows`), and `newId()` on the Plugin's context.

The Plugin is off until a Data Root turns it on (ADR-0010). Existing `comments` arrays are not migrated: core drops them when it next writes the record.
