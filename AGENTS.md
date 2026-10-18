<!-- intent-maintainer:start -->
## Library Skill Maintenance

Use the repository’s installed Intent. If it is unavailable, report the missing dependency instead of downloading a replacement.
Before substantial library source, documentation, examples, tests, or skill work, run `pnpm exec intent meta generate-skill` and follow the packaged maintainer procedure.
Use the current request and repository evidence. For initial skills, propose a useful batch and reuse any scope already agreed with the maintainer.
Before handing off a skill batch or library change, run `pnpm exec intent maintainer review --json`. Follow the maintainer procedure to update affected guidance, run task checks, and record completed review outcomes. Report an evidence-backed no-op or missing evidence explicitly.
Create and incrementally maintain domain_map.yaml, skill_spec.md, and skill_tree.yaml in the established artifact location for every skill batch. Preserve prior tasks, maintainer decisions, and remaining work.
Keep maintainer decisions and changes in the repository; do not require the user to repeat the procedure in later sessions.
Use intent maintainer setup to initialize missing records, maintainer add to register skills, maintainer status to identify work, and maintainer sync to update generated metadata. Finish with intent maintainer check.
<!-- intent-maintainer:end -->

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
