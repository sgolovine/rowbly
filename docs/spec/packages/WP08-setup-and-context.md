# WP08 — Setup & Context

**Depends on:** WP03, WP04 · **Phase:** 2

## Owns

- Service: `src/services/setup.ts`.
- Commands: `src/commands/setup.ts`, covering `init`, `use`, `whoami` and `config show`.
- TUI: `src/tui/screens/setup/**`, covering the first-run screen, the context switcher and the whoami screen.
- README section `setup`.
- Tests for all of the above.

## Behaviour

- **`rowbly init`** creates `.rowbly/` in the cwd, or `~/.rowbly` with `--global`. It refuses with a `ConflictError` if the target already exists. It writes:
  - `rowbly.config.json` containing the default stages;
  - a `.gitignore` containing `local.json`.

  It then optionally creates the first workspace and board. Interactively, it prompts through Clack for the workspace id and name and the board id, name and prefix (suggesting the board id upper-cased as the prefix). Non-interactively, it uses the flags. After creating them, it sets them as the current context.
- **`rowbly use [ws[/board]]`**: with no arguments, it prints the current context and where each part was resolved from (flag, env, local, or the only one). `--clear` removes the stored context.
- **`rowbly whoami [handle]`**: with no arguments, it prints Me and where it was resolved from (local or git email match). Setting Me validates the handle against the current workspace's roster, and warns rather than failing if the handle isn't in it. `--clear` unsets Me.
- **`rowbly config show`** prints the effective stages and fields of the resolved board, with their source levels. `--json` outputs an `EffectiveBoardConfig`.
- **TUI**:
  - a first-run screen, shown when no Data Root exists, that offers to initialize in the cwd or globally, then runs the same flow as init through a `Form`;
  - a context switcher (workspace → board picker), reachable from the `g` palette;
  - a whoami picker that lists the roster.

## Acceptance criteria

- [ ] `rowbly init --no-prompt --workspace acme --workspace-name Acme --board web --board-name Web --prefix WEB` produces exactly the layout from contracts §1, including `.gitignore`. After that, `stories list` runs without any flags.
- [ ] Running `rowbly init` a second time exits 4.
- [ ] `rowbly use acme/web`, followed by `cat .rowbly/local.json`, shows `{ version: 1, workspace: "acme", board: "web" }`. `git check-ignore .rowbly/local.json` succeeds in a test git repo.
- [ ] `whoami` resolves Me through a git email match when `local.json` has no `me`.
- [ ] TUI tests cover the first-run init flow and switching boards through the context switcher.
