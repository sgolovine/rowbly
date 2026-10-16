# Agent guide

See `docs/agents/CONTEXT-MAP.md` for domain language (core terms in `docs/agents/CONTEXT.md`, each Plugin's terms in its own `CONTEXT.md`) and `docs/` for architecture.

## TUI code organization (`src/tui/`)

- **One component per file.** Each React component lives in its own `PascalCase.tsx` file named after
  the component. Don't add new components to an existing file, and split a file when it starts holding
  several. A small private helper that only that component uses (a constant, a pure function) may stay
  in the same file.
- **Group by area, with a barrel.** Components are grouped in folders, each with an `index.ts` that
  re-exports what the rest of the app uses. Import from the folder (`'../components'`), not from files
  inside another folder.
  - `components/` — reusable UI building blocks (`Modal`, `SelectList`, `Form`, …).
  - `shell/` — the app frame: `Shell`, `Header`, `Sidebar`, `Footer`, toasts, overlays, `ScreenSlot`.
  - `screens/<area>/` — screens and their screen-specific pieces, registered in the area's `index.ts`.
  - `hooks/` — contexts and hooks.
- **Keep `app.tsx` thin.** It only wires providers around `Shell`. New layout or chrome goes in
  `shell/`; new screens go in `screens/`.
- Pure helpers and constants shared between files get their own `camelCase.ts` file (e.g.
  `shell/layout.ts`, `shell/boardKey.ts`).

## Async tests

- Synchronize on the state the **next action needs**. In TUI tests, use `waitForFrame` to wait for
  the destination screen's loaded data and relevant action before sending another key. Exclude an
  outgoing form when its text could also satisfy the matcher.
- A success toast or a saved file proves a mutation completed; it does not prove a returning screen
  finished reloading. For example, after adding a Comment, wait for its body and `edit Comment` on
  the Comments tab before pressing `e`, rather than waiting only for `Added Comment`.
- `app.press()` only paces keyboard input. Fixed sleeps, repeated key presses, retries, and larger
  timeouts are not substitutes for a readiness assertion. Use controlled promises/barriers to
  exercise delayed loads and ordering races deterministically; release them and restore mocks in
  `finally` so failures cannot leave work blocked.

## Checks

Run `pnpm typecheck`, `pnpm lint` and `pnpm test` before finishing.
