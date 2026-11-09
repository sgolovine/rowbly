# Modal

The generic Modal shows one short task over the screen. It is the Modal for the New Board, New Story and edit Forms, Move Stage and other pickers, ConfirmDialog, Help and all Plugin Modals.

- The width fits the content, with a minimum of 48 columns and a maximum of 72. The Modal is centred on the screen. The height fits the content, up to the screen height without the header and the footer. If the content is taller, the body scrolls.
- The Modal has an `overlay` fill and an `accent` frame. When the Modal is open, it is the region in focus.
- The title in the frame is a breadcrumb that gives the name of the task (`ROW-9 › Move Stage`). The last crumb is `accent` and bold. A `✕` in `ink-faint` is at the right of the top edge, for the mouse.
- The body has `col-2` padding. The Modal has no header band and no Tabs. A task with Tabs or a section list is a screen Modal (`StoryModal` or `SettingsModal`), not this Modal.
- The keys show in a `KeyHints` strip in the frame, under a `border` rule. The key that confirms the task is first (`enter move`, `ctrl+s create`). `esc back` is last.
- When the Modal opens over a screen Modal (for example, delete from a Story), it takes the focus. The screen Modal below it then changes to a `border` frame.
- An info modal has only the `esc` key, and no Form, ConfirmDialog or other key. An info modal shows a `Close` Button in place of the strip, on the same line under the rule. The Button has its label in `ink`, ` esc ` in a key cap, no frame and `selection` on hover. A click closes the info modal, as `esc` and the `✕` do. `ModalFrame` makes this decision for all core and Plugin Modals. If the Modal has a different key, the strip shows again.
- Under a different layer or a `ContextMenu`, the strip or the Close Button becomes blank but keeps its line and width. This keeps the Modal at the same size and position. A menu that opens on a row also stays next to that row.
- Plugins open only this type of Modal.
