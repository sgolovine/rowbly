# StoryCard

A Story on the Board: three rows inside a `border-round` frame. Never wraps; long names are cut with `…`.

- Row 1: the Story Key in `accent`, Priority right-aligned in `ink-muted` (`▲ High`); blank when unset.
- Row 2: the Story name in `ink` (`cell-title` when selected).
- Row 3: Plugin badges in `ink-muted`, each led by its Plugin's glyph (`◆` Epic). Kept blank when there are none, so every Story is the same height.
- Selected: the frame lights up in `accent`; no fill. Not selected: `border` frame, no fill. Today's grey-white frame on the selected Story in a Modal's background is dropped; behind a Modal the selected Story keeps its look.
- Dragged with the mouse: while the button is held over another Stage, a drop shadow (a `drop-target` fill the size of a StoryCard, no frame) sits at the bottom of that Stage's Stories, where the Story lands on release. The dragged Story stays in place until then.
