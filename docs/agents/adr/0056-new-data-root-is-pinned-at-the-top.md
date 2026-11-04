# ADR-0056: + New Data Root is a button pinned above the known Data Roots

**Status:** Accepted. Amends [ADR-0055](0055-missing-data-roots-are-listed-last.md) §1 and
[ADR-0042](0042-tui-startup-asks-for-a-data-root.md) §1 for where **+ New Data Root** appears.

ADR-0042 §1 and ADR-0055 §1 put **+ New Data Root** after the last known Data Root. With many known
Data Roots, it sits below a long list (or below the scrolling rows), so a person who wants a new one
has to read past all of them to find it.

## 1. Decision

The TUI startup picker and the Data Root switcher show **+ New Data Root** as a button pinned at the
top, above the search line and the known Data Roots. It stays there whatever the search query, and the
known Data Roots scroll below it. It shows its `n` key in both.

The known Data Roots keep the order of ADR-0055 §1. The first highlight stays on a Data Root: the one
that is open in the switcher, else the first one (the default when it exists); the button is
highlighted first only when there are no known Data Roots. `↑` from the first Data Root reaches the
button. Each change to the search query highlights the best match, or the button when nothing
matches.

## 2. Rejected alternatives

- Keeping it last, as before, leaves it hard to find in a long list.
- Highlighting the button first would make `enter` start setup rather than open the usual Data Root.
