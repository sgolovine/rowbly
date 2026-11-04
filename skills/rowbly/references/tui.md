# The TUI, for the user

Agents do not run the TUI: it is a full-screen app that waits for a person. Use this page to answer a
user who asks how to do something in it, and do the work yourself with commands. To show the user a
screen, ask them to open it; do not start `rowbly` with no command in your own shell.

`rowbly` with no command opens the TUI in a terminal (global flags such as `--data-root` still apply).
Without `--data-root`, the TUI opens the nearest `.rowbly/` in the current directory or a parent.
Outside one, known Data Roots appear before onboarding, below **+ New Data Root** pinned at the top:
default first, other registered roots next, missing ones after them. Labels, paths and missing markers identify them.
`enter` or a click opens one (a missing one says it no longer exists and offers to delete it from the
list, as the `D` switcher also does); a long list scrolls below the button, in both, and `page up`/`page down` or the mouse wheel move the highlight; `n`
opens setup. Typing searches them (`/` or any key other than `n`, `q`, `?`, `,`, `D`): fuzzy over
name, full path and `~` path, best match highlighted, `esc` clears. Failed opens leave the picker
available. With no known roots, the home-folder
fallback and first-run onboarding/setup remain available. After selection, global onboarding opens when its Home Config `onboardingComplete` flag is absent or false,
then Data Root onboarding when the same flag in `rowbly.config.json` is absent or false. The Data Root
flag is committed and shared by everyone using it. `ctrl+k` skips and saves completion. Onboarding fills the terminal with no header or sidebars; their keys (`ctrl+b`, `\`, `{`/`}`, `[`/`]`, `1`-`9`, `ctrl+p`, `n`, `,`, `D`, Plugin Actions) do nothing until it ends. Settings ›
Onboarding reopens either flow without clearing flags. Global onboarding sets global Me and registers
existing Data Roots only. Data Root onboarding has Usage, Board, Plugins, Agent skills, Stage Prompts
and Summary tabs. Exactly one Board skips its tab, puts it in context and marks it done; no Boards
offers creation, several offers selection. Plugins is always shown, Stage Prompts only with Software
Factory on. Agent skills opens directly without an AI question. Click any tab; Back `shift+←`, Next
`shift+→` and Skip onboarding `ctrl+k` remain available. Next never requires a completed step.
Stage Prompts offers default prompts, minimal placeholders (all off), or inline editing (`esc`
returns). Population is explicit, keeps existing Stages/prompts/files and shows added/kept/skipped
inline; errors allow retry. Skills is done on install or continuing, Stage Prompts on successful
population or Next. Summary lists this visit's choices, skill folders and prompt outcome; unvisited
steps read not changed in this visit. Changes and finished `onboardingSteps` save immediately;
reopening starts at the first incomplete step. Legacy `ai` counts as `skills`, `factory-setup` as
`stage-prompts`, and saved old/unknown ids are kept. Official skill installs choose a destination
folder and harness and never overwrite; custom skill commands are
explained. An explicit missing `--data-root` still fails. Without a Data Root, setup can create one. Once
onboarding is complete, a Board in context opens its Kanban board; otherwise the home menu. It reads the same files as command mode and watches the
Data Root, so changes made with commands show on their own a moment later, without losing the user's
place or what they typed in a form.

When a newer Rowbly release is on npm, a row above the footer says
`Rowbly <version> is available, update with npm i -g rowbly`; the user updates by running that
command. Offline or slow, the check shows nothing and never delays startup or quitting. Behind
Node's environment proxy (`NODE_USE_ENV_PROXY=1` or `--use-env-proxy`) the check is skipped.

## Keys on every screen

| Key | Action |
| --- | --- |
| `↑`/`↓` (or `j`/`k`) | move |
| `enter` | select or open (a click does the same) |
| `/` | filter (on the board and the Stories list: the filter form) |
| `esc` | back, or cancel the open form |
| `D` | switch Data Root (or click its name at the left of the header); in the switcher typing (`/` or any key other than `n`, `e`, `d`) searches by name or path and `esc` clears the search, `e` edits a Data Root's label and default, and `d` forgets it (the folder stays) or deletes its folder, asking first |
| `,` | settings: Boards, Stages, Fields, Me, Preferences, Doctor, Plugins, Config, and Plugin sections such as Assignees and Git |
| `ctrl+p` | find Stories from main screens (or click **🔎 Find Stories** after the Data Root); forms and modals keep their keys |
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
| Board | `←`/`→` Stage, `↑`/`↓` Story, `enter` open, `shift+←`/`shift+→` move the Story to the previous / next Stage, `shift+↑`/`shift+↓` move it within its Stage, `T`/`B` top / bottom, `n` new Story, `e` edit, `d` delete, `/` filter, `c` clear the filter, `v` list view, `r` reload. The mouse wheel over a Stage, or over the list view, scrolls it; the mouse can drag a Story to another Stage or place; a right click on a Story opens a menu of what these keys do (open, edit, move, delete), and `esc` or a click outside closes it |
| Stories list | `enter` open, `n` new Story, `/` filter and sort, `c` clear, `A` all Boards / this Board |
| Story | `tab`/`←`/`→` switch between Details and Plugin tabs (Tasks, Specs, Comments, Links), `e` edit, `m` move to a Stage, `d` delete |
| Story › Tasks, Task | `enter` open, `n` new Task, `e` edit, `m` move, `d` delete |
| Story › Comments | `n` new Comment, `e` edit, `d` delete |
| Story › Links | `↑`/`↓` select, `enter` or a click opens the linked Story, `/` filter, `n` new link (direction and same-Board Story), `d` remove the selected link after confirmation |
| Specs lists | `enter` open in the full-screen editor, `e` edit, `n` new Spec, `d` delete; `ctrl+s` saves in the editor |
| Boards | `enter` Board detail, `v` view its board without changing the context, `s` Stages, `f` Custom Fields, `n` new, `e` edit (id and key prefix cannot change), `d` delete (asks first; a Board with Stories asks again). A right click on a Board opens a menu with Open, Edit and Delete |
| Stages | `n` new, `e` edit, `shift+↑`/`shift+↓` move, `T`/`B` first / last, `d` remove |
| Fields | `n` new, `e` edit, `d` remove |
| Me | `enter` edit Global or This Data Root |
| Doctor | `f` fix, `r` check again |
| Skills (in Settings) | `i` install bundled or local skill, `n` new custom skill, `u` update, `d` delete (both ask first); `↑`/`↓` select, `/` filter |
| Plugins | `enter` turn the Plugin on or off |
| Assignees | `enter` open (Edit, Remove), `n` new Assignee |
| Epics | `enter` open, `n` new Epic, `a` open / closed / all, `e` edit, `c` close / reopen, `d` delete (asks first). A right click on an Epic opens a menu with Open, Edit, Close or Reopen, Delete |
| Stage Prompts (Software Factory, in Settings) | `space` turn on / off at the shown level, `enter` read, `e` edit (`ctrl+s` saves), `d` remove the shown level's entry and file |

With Software Factory on, a Story card or list line shows `▶ running` or `✕ failed` (`#2` after
the first attempt) while the Story's current Stage has such a Stage Run, and the Story screen has a
read-only **Stage Run** tab: outcome, attempt, worker, started by, started and finished times
with their age, how long it ran, and the failure reason. Ages come from the start and finish times
only; they say nothing about whether a running worker is still active.

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
New Story has Details, then enabled create tabs in registry order (Tasks, Specs, Links). Plugin fields move into their create tab; Assignees/Epic remain on Details. Tab moves to the next field in the current form; Shift+Tab switches to the next tab, wrapping to Details. Arrows switch from lists or after the final field and edit values while in a field. Up/down and Enter move fields. Ctrl+g switches between a Plugin's fields and draft list. In draft lists n creates, Enter edits, d removes. Ctrl+s or Ctrl+enter saves all tabs; Enter after the final Details field saves. Plugin errors select their tab and preserve drafts. Esc asks before discarding changed drafts and exits directly untouched. Edit uses the same window and navigation, loading existing Tasks, Story Specs, linked Board Specs and Links as drafts. Details and all tabs save together in one stories.update; cancellation saves none. Unchanged or unavailable Plugin Data is kept. Task numbers and creation dates are kept.

### Experimental Features

In Settings → Global → Experimental Features, select a feature to read its description and press
`enter` to turn it on or off for every Board in the Data Root. Saves and errors show as toasts. With
no features in this version, the section explains that features will appear when available and
shows no toggle hint. The long section label wraps within the Settings sidebar. In a short terminal the sidebar scrolls to keep the selected section visible; `page up`/`page down` or the mouse wheel scroll it while it has focus.

In Settings, choose **Stages** or **Fields** under **Global** to edit the defaults for Boards without their own list. Choose the matching section under **Board: <name>** to edit that Board's list. A Board without its own list uses the global list (or built-in defaults); its first edit copies that list to the Board. A Board with its own list no longer follows changes to global defaults. These sections have no scope tabs or scope-switching key. Opened outside Settings, Stages and Fields use the Board in context, or global defaults without a Board.

In Settings, choose **Stage Prompts** under **Global** or **Board: <name>**. The selected section fixes the scope for reading and writing; there are no scope tabs or `l` shortcut. Without a Board, only Global is available. Board Stages without their own Stage Prompt use the global one. Editing or toggling creates a Board entry for that Stage; removing the Board entry and file restores the global Stage Prompt. Turning a Board entry off keeps it and prevents the global prompt from applying.

In Settings → Global → Skills, the managed folder is the current working folder, independent of
the Data Root. Installed entries show official/custom, harnesses and relative installation paths;
bundled names are shown above the list. Installation accepts a bundled name or local skill folder;
creation asks for name and description. Both forms choose the harness destination and save with
`ctrl+s`. Custom instructions are edited outside the TUI. Update reinstalls the bundled version for
an official skill, or refreshes only `references/rowbly-reference.md` for a custom skill, keeping
`SKILL.md` and every other file. Delete removes the selected whole folder only after confirmation;
`n`, `esc`, or Enter on the default Cancel button cancels without writing. Only official installations
and custom folders holding `SKILL.md` and the Rowbly reference are managed. Update/delete reject
symbolic links in the managed path, including harness folders and a custom reference path.

## Find Stories

`ctrl+p` or the input-like header control opens a fuzzy finder on main screens. Use the mouse wheel
over the results to move through longer lists. Type a query;
`↑`/`↓` selects, `enter` or a click opens the Story, and `esc` closes. Search matches Story fields
and related Comments, Tasks, Specs, Epics, Assignee handles, outgoing Story Links and attachment
names from enabled Plugins. It ignores case, ranks exact/contiguous matches ahead of subsequences,
and lets space-separated terms match different fields. Missing Plugin content is skipped.
The current Board is the default scope, independent of Board filters. Settings › Global ›
Preferences › **Find Stories in full Data Root** searches every Board and shows Board names;
opening a result selects its Board. This off-by-default preference is `storyFinderAllBoards`
in `~/.rowblyrc.json`. A form or modal keeps its keys and never opens the finder.


## Board Stats

Settings → Board → Stats, or t from Board details; r refreshes. Current-record all-time Story/Done
counts and enabled Plugin metrics. Complete numbers are exact; partial numbers are known lower
bounds with reasons; unavailable is never shown as zero. Previous results stay visible during a
refresh. Leaving the page cancels requests; no background polling.
