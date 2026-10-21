# SettingsModal

A screen Modal: the settings, opened with `,`. A section list on the left, the section on the right.

- **Fixed size**, as `StoryModal`: the Board panel's area less one column and one row each side, at most 120 columns; it does not resize between sections.
- **Section list** (left, 22 columns, a `border` rule on its right): a `SidebarList` with group headings in `ink-faint` (`Global`, `Board: Rowbly`) and one blank row between groups.
- **Section** (right): a header band on `overlay-raised` with the section name in `cell-title` and one line on what it holds in `ink-faint`, then the section's content with `col-2` padding. An empty section says what to do (`No Custom Fields. n adds one.`).
- **Two focus states**, one at a time:
  - the list in focus: its highlighted row has the `selection` fill and `accent` bar; hints `↑↓ section · enter open section · esc close`;
  - the section in focus: the list's selected row keeps its bar and fill; the section's own rows take the `selection` fill; hints are the section's keys, ending `esc back to sections`.
- Title in the frame: `Board › Settings`. Forms opened from a section (New Stage, edit Board) are generic Modals on top.
- Plugin settings appear as sections under a `Plugins: <name>` group; Plugins do not open their own settings Modal.
