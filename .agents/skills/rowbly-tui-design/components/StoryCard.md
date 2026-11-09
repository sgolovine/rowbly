# StoryCard

A StoryCard shows a Story on the Board as three rows in a `border-round` frame. It never wraps. A long name is cut with `…`.

- Row 1: The Story Key is in `accent`. The Priority is right-aligned in `ink-muted` (`▲ High`), and is blank when it is not set.
- Row 2: The Story name is in `ink` (`cell-title` when the Story is selected).
- Row 3: Plugin badges are in `ink-muted`, and the glyph of the Plugin is first in each badge (`◆` Epic). If there are no badges, the row stays blank, so all Stories have the same height.
- Selected: The frame changes to `accent`, with no fill. Not selected: The frame is `border`, with no fill. The current grey-white frame on the selected Story in the background of a Modal is removed. Behind a Modal, the selected Story keeps the same appearance.
- Right-clicked: The Story becomes selected. A `ContextMenu` opens at the pointer and shows what the keys of the board do to the Story.
- Dragged with the mouse: While the user holds the button over a Stage, a drop shadow takes the slot under the pointer. The drop shadow is a `drop-target` fill with the size of a StoryCard and no frame. The Stories at and after that slot move down to make space. When the user releases the button, the Story goes into that slot. Over a different Stage, the dragged Story stays in its position until the release. Over its own Stage, the dragged Story is not shown, and the shadow shows where it will go.
