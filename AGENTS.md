# Agent guide

See `CONTEXT-MAP.md` for domain language (core terms in `CONTEXT.md`, each Plugin's terms in its own `CONTEXT.md`) and `docs/` for architecture.

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

## Checks

Run `pnpm typecheck`, `pnpm lint` and `pnpm test` before finishing.
