# Modal

The generic Modal: one short task over the screen. New Board, New Story and edit Forms, Move Stage and other pickers, ConfirmDialog, Help, and every Plugin Modal.

- Sized to its content: at least 48 columns, at most 72, centred. Height fits the content up to the screen less the header and footer, then the body scrolls.
- `overlay` fill, `accent` frame: while open it is the region in focus.
- Title in the frame as a breadcrumb naming the task (`ROW-9 › Move Stage`), last crumb `accent` bold; `✕` in `ink-faint` at the right of the top edge for the mouse.
- Body with `col-2` padding; no header band and no Tabs. A task that needs Tabs or a section list is a screen Modal: `StoryModal` or `SettingsModal`, not this.
- Keys in a `KeyHints` strip inside the frame, under a `border` rule; the confirming key first (`enter move`, `ctrl+s create`), `esc back` last.
- Opened over a screen Modal (delete from a Story), it takes the focus and the screen Modal below drops to a `border` frame.
- Under another layer or a `ContextMenu` the strip goes blank but keeps its line and width, so the Modal does not resize or move and a menu opened on a row stays next to that row.
- Plugins open only this kind.
