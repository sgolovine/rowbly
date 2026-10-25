# Button

A clickable label with its key beside it in a key cap: the header controls and the `+ New …` foot of each sidebar. No frame of its own.

- Quiet by default: label in `ink`, then its key in a key cap: the key with one column of `keycap` fill each side (` n `), in `ink-muted`. The cap reads as a key and as secondary to the label. One column of padding each side of the whole control is the click target; on mouse hover it fills with `selection`.
- `primary`: label in `accent` bold, key cap text in `accent`. One per screen, for the thing the screen is for: **+ New Story** on the Board.
- `busy`: a Plugin Action whose work is running (such as Sync). The label ends in `…` and shows in `ink-muted`; the key cap stays, but the key and the click do nothing, there is no hover fill, and the key leaves the footer until the work ends.
- Every control is separated from the next by a `|` in `border-control`; the controls' own padding gives one column each side of it.
- Labels are the noun or `+ New <noun>`; the key always shows. The sidebar foot Buttons (`+ New Board [N]`, `+ New Epic [n]`) are quiet Buttons too, with the same key cap. Footer and Modal key hints are not Buttons: they stay `KeyHints`.
- Why no frame: in a terminal a framed control is three rows tall and at least label + 4 columns wide. Four of them in a row outweighed the Board. Inline, they cost no rows beyond the header Panel's own.
- The key cannot be set smaller: a terminal has one cell size. The `keycap` fill and `ink-muted` text do that job.
