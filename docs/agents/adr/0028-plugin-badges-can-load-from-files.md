# ADR-0028: Plugin badges can load what they show from the Plugin's files

**Status:** Accepted. Built.

The Epics Plugin shows a Story's Epic on its board card, its line in the board's list view and its row in the Stories list. The Story's bag holds only the Epic ID; the Epic's name is in its Epic file. `PluginTui.storyBadges` (ADR-0023) runs while the screen renders, so it must not read files and cannot show the name.

The Plugin API gains `PluginTui.loadStoryBadges({ plugin })`. It reads what the badges need, once each time the board or the Stories list loads its Stories, and returns a function from a Story to its badges. The screens load it beside their Stories, so it follows their reloads: an Epic renamed elsewhere shows its new name when the board is shown again. Its badges show after the Plugin's `storyBadges`, in registry order, and a load or badge that throws shows none, as with `storyBadges`. `storyBadges` stays for badges that need only the Story.

The Epics Plugin shows `◆ <Epic name>`, and the Epic ID when the Epic file is missing or cannot be read.

We rejected showing the Epic ID with `storyBadges`: the ID is a slug, not the name people gave the Epic. We rejected copying the Epic's name into each Story's bag: renaming an Epic would then rewrite every Story of the Epic, and a Story could show a stale name. We rejected letting `storyBadges` return a promise: it runs for every card on every render, so each render would read the files again.
