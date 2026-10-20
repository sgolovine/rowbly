# ADR-0009: Built-in Plugins live in this repository and use only the Plugin API

**Status:** Accepted. Built. A narrow `git` capability for Automatic Commits is built by ADR-0025; further Git automation remains planned in ADR-0016.

Rowbly keeps its core small and adds features as Plugins. For now every Plugin is a Built-in Plugin: a folder `src/plugins/<id>/` that is built into the same bundle as core and listed in one static registry. Loading a Plugin means activating it at startup when the Data Root turns it on (ADR-0010). A Plugin imports only the public Plugin API, never a core module directly. Core never imports a Plugin; only the entry point reads the registry. The architecture test enforces both rules. A Plugin's TUI part loads only when the TUI starts, so command mode starts as fast as before.

A Plugin does work outside its own data only through capabilities that the Plugin API offers: for example, reading and writing its own `plugins/<id>/` folders, running `git` in the repository that holds the Data Root, or opening `$EDITOR`. The architecture test forbids Node built-in modules in Plugins. The Plugin API gets a new capability when a Plugin first needs it. This list of capabilities is also what a permission model for third-party Plugins will need.

We considered packages in a pnpm workspace, and npm packages loaded by name. Both add packaging and a dynamic loader before any third-party Plugin exists. Third-party Plugins are out of scope for now. Because Built-in Plugins use the same Plugin API that third-party Plugins will use, a loader for third-party Plugins can later feed the same registry.
