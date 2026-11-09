# Button

A Button is a label that you can click, with its key next to it in a key cap. The header controls and the `+ New …` control at the bottom of each sidebar are Buttons. A Button has no frame.

- Quiet: a Button is quiet by default. The label is in `ink`, and then its key is in a key cap. A key cap is the key with one column of `keycap` fill on each side (` n `), in `ink-muted`. The key cap looks like a key, and it is less important than the label. One column of padding on each side of the full control is the click target. When the mouse pointer is on the control, this area fills with `selection`.
- `primary`: the label is in `accent` bold, and the key cap text is in `accent`. Use only one primary Button on each screen. Use it for the main task of the screen, for example **+ New Story** on the Board.
- `busy`: a `busy` Button is a Plugin Action that is in progress (for example, Sync). The label ends in `…` and is in `ink-muted`. The key cap stays, but the key and the click do nothing. There is no fill when the mouse pointer is on the Button. The key goes out of the footer until the work is complete.
- A `|` in `border-control` separates each control from the next control. The padding of the controls gives one column on each side of the `|`.
- The label is the noun or `+ New <noun>`. The Button always shows its key. The Buttons at the bottom of the sidebars (`+ New Board [N]`, `+ New Epic [n]`) are also quiet Buttons, with the same key cap. Footer and Modal key hints are not Buttons. They stay `KeyHints`.
- Why no frame: in a terminal, a control with a frame is three rows tall. It is also a minimum of the label width plus 4 columns wide. Four of these controls in a row took attention away from the Board. Without a frame, the Buttons use no rows in addition to the rows of the header Panel.
- You cannot make the key smaller, because a terminal has only one cell size. The `keycap` fill and the `ink-muted` text make the key look less important than the label.
