# ADR-0038: Story image paste is an exclusive Plugin contribution

**Status:** Accepted

## 1. Context

Core owns the Story screens and clipboard gestures, while Plugins own the meaning and persistence
of pasted images. A new or edited Story must save its fields and pending Plugin input together.
Clipboard reading is already bounded and isolated by ADR-0037. ROW-28 supplies the TUI contract;
image management Plugins and their tabs are separate work.

## 2. Decision

- `PluginTui.storyPaste` is exclusive. It declares `story`, `form` and `input` callbacks. A second
  claimant fails to load as a whole under ADR-0020 §8. Only successfully activated Plugins own claims;
  a failed startup releases the staged claim. The existing load test checks both paths.
- Core handles Ctrl+V, Alt+V, Ctrl+Alt+V and empty Ink bracketed paste while an open Story or its
  new/edit form is active, across tabs and field focus. Nonempty bracketed paste remains text.
  `v` stays reserved in `CORE_KEYS`, which already reserves the Board view key.
- A nested task, another screen, a full-screen text editor, or saving a form disables image paste.
  A read in flight blocks overlapping gestures for that TUI session, even across screen changes.
  After reading, core checks that the same screen, services, active state and claimant still own it.
- An open Story calls `story({ story, image, plugin, ui })` through the Plugin error adapter in the
  `screen` stage, then reloads. The Plugin saves immediately through its own operations.
- A form calls synchronous `form({ boardId, story, image, pending, setPending, plugin, ui })` in the
  `field` stage. It must only stage in memory. The host holds the opaque pending value above the
  fields and tabs, marks it dirty, and keeps it through validation or save failures. Cancellation
  writes nothing. `input({ pending, story })` converts it into the claimant's single create/update
  input. Object input merges over that Plugin's field input; pending keys win. Successful save
  clears pending data. Plugins persist it through their normal operation transforms.
- A spinner toast stays until reading and handling finish, and is removed when its owner closes or
  becomes inactive. The active claimant gets a `ctrl+v paste image` hint on macOS/Linux and
  `alt+v paste image` on Windows, gated like input. No claimant gets no hint; a gesture explains
  that a Plugin taking pasted images must be turned on.
- Core explains no-image, too-large and timeout results separately. Unsupported/no-display results
  get generic environment guidance, plus `wl-clipboard` guidance on Wayland. Any Plugin command
  guidance belongs to the claimant. Core contains no image-management Plugin terminology.

## 3. Rejected alternatives

- A handler per tab or field would lose gestures outside that focus and complicate pending state.
- Calling all claimants would read or save the same gesture more than once.
- Saving form images immediately would leave data behind on cancellation or a rejected Story save.
- An image-management Built-in Plugin in core would couple this contract to its later consumer.
