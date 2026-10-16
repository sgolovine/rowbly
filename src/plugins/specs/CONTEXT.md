# Specs

A Built-in Plugin that keeps Spec documents with the Stories and Boards they describe.

## Language

**Spec**:
A markdown document that describes work to be done, titled by its first level-one heading (the first line that starts with `# `; an earlier `## ` heading does not count); it is only a document, with no approval or Stage of its own.
_Avoid_: specification, design doc, PRD

**Story Spec**:
A Spec that belongs to exactly one Story; a Story has at most one.
_Avoid_: story doc

**Board Spec**:
A Spec that belongs to a Board, identified by a slug, and that Stories on the same Board link to; a Story can link to any number of Board Specs.
_Avoid_: shared spec, board doc
