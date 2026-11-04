# ADR-0042: TUI startup asks for a Data Root outside local discovery

**Status:** Accepted; §1's order and missing-root picks amended by [ADR-0055](0055-missing-data-roots-are-listed-last.md), which lists missing roots last. Amends ADR-0033 §1 for TUI startup and ADR-0041 §2 for startup ordering.

A default Data Root makes CLI commands convenient, but opening it automatically in the TUI hides
which Data Root a person can choose when their current directory has none.

## 1. Decision

An explicit `--data-root` keeps its existing resolution and errors. Otherwise TUI startup opens the
nearest `.rowbly/` in the current directory or a parent. When there is no such Data Root and the
Home Config lists known Data Roots, startup shows a picker even if a default exists. The default
comes first, other roots retain registered order, and New comes last. Rows identify labels, paths
and missing roots. Keyboard and mouse can select a root; `n` opens existing setup. Failed opens
leave the picker available. Opening a root does not change its label or default.

The picker precedes incomplete global onboarding. Selecting or creating a Data Root continues
applicable global and Data Root onboarding. Global onboarding without a selected Data Root returns
to the picker if roots were registered, rather than choosing the default or first entry itself.
With no known Data Roots, the existing home-folder fallback and first-run onboarding/setup remain.
CLI commands keep ADR-0033's resolution order and errors. `ROWBLY_ROOT` remains rejected and an
unreadable Home Config still fails normally.

## 2. Rejected alternatives

- Opening the default automatically would bypass the requested choice.
- Showing global onboarding before the picker would delay selecting the Data Root being opened.
- Changing CLI resolution would redirect existing commands and scripts outside this TUI change.
