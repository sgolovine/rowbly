# WP11 — Hardening & Docs

**Depends on:** all other packages · **Phase:** 4

## Goal

Check the whole product end to end, make it consistent, and document it.

## Owns

- `test/e2e/**`.
- `README.md` (all sections; you may now edit across the markers).
- `--help` text and wording in any command file. Wording only: no behaviour changes without a supervisor-approved follow-up.
- `docs/spec/README.md` §4, to update the status table.

## Deliverables

1. **End-to-end scenario test.** It runs the built CLI through this sequence:
   1. `init` with flags;
   2. add two assignees and run `whoami`;
   3. add a board-level stage and a select field;
   4. create 5 stories with mixed fields, in two epics across two boards;
   5. move and rank stories;
   6. add tasks and comments;
   7. `epics show` progress;
   8. remove a stage with `--move-to`;
   9. remove an assignee;
   10. run `doctor`, which must exit 0;
   11. `--json` round-trips for every list command.
2. **Parity audit.** A table in the PR mapping every command-mode capability to its TUI path. Every gap is either fixed (if it's small) or reported to the supervisor.
3. **Language audit.**
   - A grep test fails if any `_Avoid_` term from `CONTEXT.md` (`issue`, `ticket`, `sub-task`, `subtask`, `column`) appears in help text or user-facing messages. An allowlist covers legitimate uses, such as "column" in the TUI layout code.
   - Exit codes match contracts §6, checked by a table-driven test.
4. **README.**
   - What Rowbly is.
   - Install (`pnpm install && pnpm build && pnpm link --global`).
   - A quick start: `init`, `use`, `stories create`, then `rowbly`.
   - Concepts, linking to `CONTEXT.md`.
   - Data Root and git workflow, including that deleted keys may be reused and how to use `doctor` after merges.
   - The configuration cascade.
   - The full command reference.
   - TUI keys.
   - Exit codes.
5. **Status update.** Mark every package as merged in `docs/spec/README.md`.

## Acceptance criteria

- [ ] The e2e scenario passes in CI-like conditions: no TTY, and with `NO_COLOR=1`.
- [ ] The parity table has no open gaps, or the gaps it has were explicitly accepted by the user at completion.
- [ ] The language audit test passes.
- [ ] A fresh clone, followed by the README install steps and the quick start, works as documented. The supervisor runs this check.
