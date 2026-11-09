# Switch

A Switch shows a setting that is on or off. It shows a track with a knob, and then the label of the current state.

- On: `━━●` and the on label, in `ink`. Off: `●──` in `ink-faint`, and the off label in `ink-muted`. Do not use `accent`, because only the focus is in `accent`.
- Always show the label of the state, for example `Enabled` or `Disabled`. The knob position must never be the only signal.
- A click toggles the Switch. In a Form, use the `switch` field kind. Then `space` and `←/→` also toggle it.
- Use a Switch for a setting that changes how a record operates, for example the Status of a Stage. Use a `boolean` checkbox for a custom field value.
