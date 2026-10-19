# ADR-0006: Ink owns the interactive mode; Clack only prompts in command mode

**Status:** Accepted.

Running `rowbly` with no command starts a full-screen Ink app. That app includes the Kanban board, detail views and every create/edit form, and it gives full CRUD parity with command mode. `@clack/prompts` is used only in command mode, to ask for missing required arguments when stdin is a TTY. We decided against mixing Clack prompts into the Ink app because both libraries take control of stdin and raw mode. Handing control back and forth between them on every form makes terminal behaviour fragile.
