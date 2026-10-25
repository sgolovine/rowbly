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
| Story | `tab`/`←`/`→` switch between Details and Plugin tabs (Tasks, Specs, Comments), `e` edit, `m` move to a Stage, `d` delete |
| Story › Tasks, Task | `enter` open, `n` new Task, `e` edit, `m` move, `d` delete |
| Story › Comments | `n` new Comment, `e` edit, `d` delete |
| Specs lists | `enter` open in the full-screen editor, `e` edit, `n` new Spec, `d` delete; `ctrl+s` saves in the editor |
| Boards | `enter` Board detail, `v` view its board without changing the context, `s` Stages, `f` Custom Fields, `n` new, `e` edit (id and key prefix cannot change), `d` delete (asks first; a Board with Stories asks again). A right click on a Board opens a menu with Open, Edit and Delete |
| Stages | `n` new, `e` edit, `shift+↑`/`shift+↓` move, `T`/`B` first / last, `d` remove, `l` switch level |
| Fields | `n` new, `e` edit, `d` remove, `l` switch level |
| Me | `enter` edit Global or This Data Root |
| Doctor | `f` fix, `r` check again |
| Plugins | `enter` turn the Plugin on or off |
| Assignees | `enter` open (Edit, Remove), `n` new Assignee |
| Epics | `enter` open, `n` new Epic, `a` open / closed / all, `e` edit, `c` close / reopen, `d` delete (asks first). A right click on an Epic opens a menu with Open, Edit, Close or Reopen, Delete |

Right-click an Epic in the Epics sidebar for **Edit** (`e`) and **Delete** (`d`), without changing the filter. With that sidebar focused, `e`/`d` act on the picked Epic. Delete asks first; **All Epics** has no record menu.
