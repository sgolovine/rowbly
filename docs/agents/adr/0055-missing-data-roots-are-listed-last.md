# ADR-0055: Missing Data Roots are listed last and picking one offers to delete it from the list

**Status:** Accepted. Amends [ADR-0042](0042-tui-startup-asks-for-a-data-root.md) §1 for the order of
the startup picker and what picking a missing root does. Amended by
[ADR-0056](0056-new-data-root-is-pinned-at-the-top.md): **+ New Data Root** is pinned at the top.

ADR-0042 §1 puts the default Data Root first and the other known Data Roots in registered order,
with missing roots marked in place. A missing root at the top of the list, often a default whose
folder was moved, pushes the roots a person can open below one they cannot, and picking it only
reports an error that tells them to remove it from the list themselves.

## 1. Decision

The TUI startup picker and the Data Root switcher list the known Data Roots that exist first and
the missing ones after them; **+ New Data Root** stays last. Each group keeps ADR-0042 §1's order:
the default first, the others in registered order. A missing default is therefore listed with the
missing roots, after every root that exists, and keeps its `default` marker. Typing a search ranks the
matches best first; matches that rank equally keep this order.

Picking a missing root, or one whose folder is found gone when it is opened, shows a dialog that
says the Data Root no longer exists and asks to delete it from the list. Deleting removes only its
entry in `~/.rowblyrc.json`, as forgetting it does; Rowbly writes no folder. Keeping it returns to
the list unchanged. A root that cannot be opened for another reason still shows its error, and the
picker or the switcher stays available. Opening an existing root does not change its label or the
default, as before.

## 2. Rejected alternatives

- Keeping the missing default first would leave the first row one that cannot be opened.
- Hiding missing roots would leave stale Home Config entries with no prompt to remove them.
- Deleting the entry without asking would drop a root whose drive or mount is only absent for now.
