# DetailView

A DetailView shows the label–value rows of a record. The Details tab and the settings screens use it.

- The labels are in `ink-muted`, in one column. This column has sufficient width for the longest label. The values are in `ink`. If there is no value, the row shows `—` in `ink-faint`.
- Each value uses its component. A Stage is a `StageBadge`, and an Epic is its `◆` and its name.
- Dates are in a format that people can read easily (`20 Oct 2026, 23:03`). If a date is near the current time, a relative time in `ink-faint` follows it.
