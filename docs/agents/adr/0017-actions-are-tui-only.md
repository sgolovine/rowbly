# ADR-0017: Actions are TUI only

**Status:** Accepted. Built.

An Action is a key, with a matching button, that a Plugin adds to the TUI. It names its target, which is a Board, a Story, a Task or nothing, and it shows wherever that target is in focus. For example, a Story Action shows on the board for the selected Story and on the Story screen. It is listed in the footer and the help, and it has a button in the header. A Plugin does not choose screens by name, so it does not depend on core screen names, and new screens show Actions automatically.

This is an exception to the rule that every feature works in both the CLI and the TUI (ADR-0006). We considered Actions that the CLI also runs, as `rowbly <plugin-id> <action> <target>`, but in command mode a Plugin's own commands already do that job. An Action by itself may only open or show something. Any data change that an Action makes must also be available as a Plugin command or as a Plugin option on a core command, so the change is still possible in both surfaces. For example, an Action that links a Spec to a Story needs `stories edit --add-spec`.
