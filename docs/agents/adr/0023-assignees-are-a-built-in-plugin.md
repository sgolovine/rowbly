# ADR-0023: Assignees are a Built-in Plugin

**Status:** Accepted. Built. Amended by ADR-0028 (`PluginTui.loadStoryBadges`) and ADR-0032 (Me is global, with a local Me in Local State).

Assignees were part of core: a roster in `rowbly.config.json`, an `assignees` list on every Story, an Assignees service with the `assignees.*` operations, the `rowbly assignees` commands, `--assignee` options on Story commands, and an Assignees screen. Not every Data Root has more than one person, and Assignees did not need anything a Plugin cannot have, so they move into the Assignees Built-in Plugin, like Epics (ADR-0014) and Comments (ADR-0018). Core no longer has an Assignee schema, a roster, Assignee bags, `story.assignees` or `assignees.*` core operations, and no Assignee code outside `src/plugins/assignees/`.

The roster is one Plugin file, `.rowbly/plugins/assignees/roster.json` (ADR-0013), with `version: 1`. One file keeps the roster as it was, a single list in the Data Root. A Story's Assignees are Plugin Data on the Story (ADR-0011), as `"plugins": { "assignees": { "assignees": [ … ] } }`; a Story without Assignees has no bag. The Plugin's operations keep the old names, `assignees.add`, `assignees.update` and `assignees.remove`, and its commands and Story options keep their flags and output. Doctor's `UNKNOWN_ASSIGNEE` becomes the Plugin's `ASSIGNEES_UNKNOWN_ASSIGNEE`, and a Me that is not in the roster becomes `ASSIGNEES_UNKNOWN_ME` instead of `STALE_LOCAL_STATE`.

**Me stays in core.** Me is who the local developer is, which core records as a Story's `createdBy` and Plugins such as Comments record as an author. It is a handle in Local State, claimed with `rowbly whoami`, which now accepts any slug. Core no longer checks Me against a roster, and no longer matches Me from `git config user.email`, because that needs the roster's emails. We rejected moving Me into the Plugin: Comments would then need the Assignees Plugin to record an author, and Plugin dependencies are deferred (ADR-0021).

The Plugin API gains what the move needed: `PluginTui.storyBadges`, short texts that the TUI shows on a Story's board card and Story list row (`@handle`). A root config no longer always has a key that sets it apart from Local State, so `writeBag` now recognises the root config by the copy a Plugin's `updateRootConfig` updater gets.

The Plugin is off until a Data Root turns it on (ADR-0010). Existing rosters and Story `assignees` lists are not migrated: core drops them the next time it writes `rowbly.config.json` or the Story.
