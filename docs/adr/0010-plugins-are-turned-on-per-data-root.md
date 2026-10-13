# Plugins are turned on per Data Root, and a broken Plugin is skipped

A Plugin is off until `rowbly.config.json` turns it on, for example `"plugins": { "epics": { "enabled": true } }`. Setting `enabled` to `false` turns the Plugin off and keeps its settings. The file is committed, so everyone who uses the Data Root has the same Plugins on. This matters because Plugin Data lives in the shared Data Root, and every teammate's Rowbly must read it the same way. We rejected turning Plugins on per developer in `local.json`, turning them on per Board in `board.config.json`, and keeping every Built-in Plugin always on, which would not keep core small.

A Plugin's settings sit beside `enabled`, which is the only key that core reserves in the entry. A Board can change those settings in its own bag in `board.config.json`. This follows the Configuration Cascade (ADR-0005): a list at the Board level replaces the Data Root's list, and other settings are deep-merged. Only the Data Root turns a Plugin on or off.

`rowbly plugins list|show|enable|disable` and a Plugins section in the TUI settings manage this. `disable` sets `enabled` to `false` and deletes no data.

A Plugin that fails to load does not stop Rowbly. A Plugin fails to load when it throws while it starts, when its settings are invalid, or when `rowbly.config.json` names a Plugin that this Rowbly version does not have (for example, because a teammate uses a newer version). Rowbly then runs without that Plugin and warns once per run: on stderr in command mode, and as a toast in the TUI. It keeps the Plugin's data unchanged, and `rowbly doctor` reports the failure as `PLUGIN_FAILED`, an error.

Third-party Plugins will need more care: if a committed setting can load code, then cloning a repository and running `rowbly` can run that code.
