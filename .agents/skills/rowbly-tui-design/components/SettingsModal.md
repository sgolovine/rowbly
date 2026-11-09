# SettingsModal

SettingsModal is a screen Modal that shows the settings. The `,` key opens it. It has a section list on the left and the section on the right.

- **Fixed size**: The size is the same as the size of `StoryModal`. It is one column and one row smaller on each side than the area of the Board panel. The maximum width is 120 columns. The Modal does not resize between sections.
- **No padding**: The Modal uses `flush`. The two `Panel`s go to the edges of the Modal frame, with one column between them.
- **Section list** (left, 22 columns): The list is in a `Panel` with the title `Sections`. It has group headings in `ink-faint` (`Global`, `Board: Rowbly`). There is one blank row between groups.
- **Section** (right): The section is in a `Panel` with the section name as its title. The section starts with one line about the contents of the section, in `ink-faint`. The content of the section is under this line. An empty section tells the user what to do (`No Custom Fields. n adds one.`).
- **Two focus states**, only one at a time. The `Panel` in focus has an `accent` frame, and the other `Panel` has a `border` frame. A Form on top of a section changes the two frames to `border`. A click in a `Panel` moves the focus to it.
  - The list in focus: The highlighted row has the `selection` fill and the `accent` bar. The hints are `↑↓ section · enter open section · esc close`.
  - The section in focus: The selected row of the list keeps its bar and fill. The rows of the section get the `selection` fill. The hints are the keys of the section, and the last hint is `esc back to sections`.
- The title in the frame is `Board › Settings`. Forms that open from a section (New Stage, edit Board) are generic Modals on top.
- Plugin settings show as sections in a `Plugins: <name>` group. If the Plugin declares Global scope, Board scope or both, its scoped links show in those groups instead. Plugins do not open their own settings Modal.
