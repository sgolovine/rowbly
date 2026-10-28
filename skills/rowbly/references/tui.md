# The TUI, for the user

Agents do not run the TUI: it is a full-screen app that waits for a person. Use this page to answer a
user who asks how to do something in it, and do the work yourself with commands. To show the user a
screen, ask them to open it; do not start `rowbly` with no command in your own shell.

`rowbly` with no command opens the TUI in a terminal (global flags such as `--data-root` still apply).
With no Data Root, a first-run screen offers to create one. With a Board in context it opens that
Board's Kanban board; otherwise the home menu. It reads the same files as command mode and watches the
Data Root, so changes made with commands show on their own a moment later, without losing the user's
place or what they typed in a form.

## Keys on every screen

| Key | Action |
| --- | --- |
| `↑`/`↓` (or `j`/`k`) | move |
| `enter` | select or open (a click does the same) |
| `/` | filter (on the board and the Stories list: the filter form) |
| `esc` | back, or cancel the open form |
| `D` | switch Data Root (or click its name at the left of the header); in the switcher `e` edits a Data Root's label and default, and `d` forgets it (the folder stays) or deletes its folder, asking first |
| `,` | settings: Boards, Stages, Fields, Me, Preferences, Doctor, Plugins, Config, and Plugin sections such as Assignees and Git |
| `ctrl+b` | hide or show the Board sidebar. With the sidebar focused (click it), `n` new Board, `e` edit and `d` delete the selected Board; a right click on a Board opens a menu with Edit and Delete for it |
| `\` | show the next Plugin Sidebar (such as Epics), or none |
| `{`/`}` | previous / next entry of the Plugin Sidebar |
| `S` | with the Git Plugin on: Sync, which commits pending Rowbly changes, rebases onto the branch's upstream and pushes (never forced); shows `Sync…` while it runs. See [Git Plugin](plugin-git.md) §6 |
| `?` | the keys of the current screen |
| `q` | quit (from the first screen) |

On every screen or tab that can create a record, `n` creates one. In a form, `enter`/`tab` move to the
next field, `ctrl+enter` or `ctrl+s` saves, `ctrl+f` opens a description in the full-screen editor.
In that field editor, `ctrl+s`, `esc` or `ctrl+f` returns to the form with the text kept; it does not
submit the form. Press `ctrl+s` again in the form to save.
After a new Story is saved, the TUI returns to the Board or list it was created from. To open each new
Story instead, turn on **Open Story after creation** in the settings' **Preferences** section (off by
default; kept in `~/.rowblyrc.json`).

## Keys per screen

| Screen | Keys |
| --- | --- |
| Board | `←`/`→` Stage, `↑`/`↓` Story, `enter` open, `shift+←`/`shift+→` move the Story to the previous / next Stage, `shift+↑`/`shift+↓` move it within its Stage, `T`/`B` top / bottom, `n` new Story, `e` edit, `d` delete, `/` filter, `c` clear the filter, `v` list view, `r` reload. The mouse can drag a Story to another Stage or place; a right click on a Story opens a menu of what these keys do (open, edit, move, delete), and `esc` or a click outside closes it |
| Stories list | `enter` open, `n` new Story, `/` filter and sort, `c` clear, `A` all Boards / this Board |
| Story | `tab`/`←`/`→` switch between Details and Plugin tabs (Tasks, Specs, Comments, Links), `e` edit, `m` move to a Stage, `d` delete |
| Story › Tasks, Task | `enter` open, `n` new Task, `e` edit, `m` move, `d` delete |
| Story › Comments | `n` new Comment, `e` edit, `d` delete |
| Story › Links | `↑`/`↓` select, `enter` or a click opens the linked Story, `/` filter, `n` new link (direction and same-Board Story), `d` remove the selected link after confirmation |
| Specs lists | `enter` open in the full-screen editor, `e` edit, `n` new Spec, `d` delete; `ctrl+s` saves in the editor |
| Boards | `enter` Board detail, `v` view its board without changing the context, `s` Stages, `f` Custom Fields, `n` new, `e` edit (id and key prefix cannot change), `d` delete (asks first; a Board with Stories asks again). A right click on a Board opens a menu with Open, Edit and Delete |
| Stages | `n` new, `e` edit, `shift+↑`/`shift+↓` move, `T`/`B` first / last, `d` remove, `l` switch level |
| Fields | `n` new, `e` edit, `d` remove, `l` switch level |
| Me | `enter` edit Global or This Data Root |
| Doctor | `f` fix, `r` check again |
| Plugins | `enter` turn the Plugin on or off |
| Assignees | `enter` open (Edit, Remove), `n` new Assignee |
| Epics | `enter` open, `n` new Epic, `a` open / closed / all, `e` edit, `c` close / reopen, `d` delete (asks first). A right click on an Epic opens a menu with Open, Edit, Close or Reopen, Delete |
| Stage Prompts (Software Factory, in Settings) | `space` turn on / off at the shown level, `enter` read, `e` edit (`ctrl+s` saves), `d` remove the shown level's entry and file, `l` switch Board / global level |

With Software Factory on, each Stage heading in the Board's Stages view has a clickable `✎`.
It opens that Stage's effective Stage Prompt in the fullscreen viewer, including when the prompt
is off or missing (a missing file starts with a template). `tab` or `e` switches to editing;
`ctrl+s` saves, and closing unsaved edits asks before discarding them. Saving writes the shown
Board's own Stage Prompt, preserving its on/off setting; an inherited prompt becomes a Board
entry with the global entry's setting. Use Stage Prompts in Settings to change that setting.

Right-click an Epic in the Epics sidebar for **Edit** (`e`) and **Delete** (`d`), without changing the filter. With that sidebar focused, `e`/`d` act on the picked Epic. Delete asks first; **All Epics** has no record menu.


## Clipboard images on Stories

On an open Story or its new/edit form, `ctrl+v`, `alt+v`, `ctrl+alt+v` or empty bracketed paste reads
an image for the single active Plugin that takes pasted images, across tabs and fields. The hint is
`ctrl+v paste image` on macOS/Linux, `alt+v paste image` on Windows, and absent without that Plugin.
Nonempty paste stays text. Other screens, tasks, the full-screen editor and saving disable image
paste. A spinner spans reading/handling; repeated gestures while busy are ignored, and the paste hint
stays hidden even after opening another Story until that work finishes. An open Story
saves immediately through its Plugin; a form keeps images pending through failures until save,
and cancellation writes nothing. No claimant: `Turn on a Plugin that takes pasted images`.
No image: `No image on the clipboard`. Size and timeout have separate messages; unavailable access
gets environment guidance, including `wl-clipboard` on Wayland. Enable Attachments with `rowbly plugins enable attachments`. Its Story tab lists name, size and date:
`n` new Attachment by PNG path, `o` open, `d` remove (confirmation). Story/card badges show `📎2`.
Paste saves immediately on an open Story; new/edit forms show `Attachments: 2 images (612 KB)` on
Details/in the edit form, keep at most 10 MiB pending in memory, and ask before discarding.
macOS screenshot to clipboard: Cmd+Ctrl+Shift+4 (Cmd+Shift+4 saves a file). Windows: Win+Shift+S.
Linux shortcuts depend on the desktop; Sway/Hyprland may need wl-clipboard. For SSH/headless or
unsupported clipboard access, use `rowbly attachments add <KEY> <file>` or the tab's `n` file path.
New Story has Details, then enabled create tabs in registry order (Tasks, Specs, Links). Plugin fields move into their create tab; Assignees/Epic remain on Details. Tab switches tabs; arrows switch from lists or after the final field and edit values while in a field. Up/down and Enter move fields. Ctrl+g switches between a Plugin's fields and draft list. In draft lists n creates, Enter edits, d removes. Ctrl+s or Ctrl+enter saves all tabs; Enter after the final Details field saves. Plugin errors select their tab and preserve drafts. Esc asks before discarding changed drafts and exits directly untouched. Edit stays flat.
