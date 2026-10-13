# Stages and Custom Fields are configuration, and the most specific level replaces the levels above

Stages and Custom Fields are not stored as entity files. They are ordered lists in the Configuration Cascade: `rowbly.config.json`, then `workspace.config.json`, then `board.config.json`. The most specific level that defines `stages` or `customFields` replaces the lists from the levels above it. The lists are not merged by key. Other scalar settings are deep-merged. When you edit a Board's stages or fields and the Board does not yet define its own list, Rowbly first copies the inherited list into `board.config.json` and then applies the change.

`ARCHITECTURE.md` gave Stages a `boardId` like data entities. We rejected that model because Stages and Custom Fields define the shape of a Board's data and are not data themselves. We also rejected merging by key, because removing an inherited entry would need extra syntax and the resulting Stage order would be unclear.
