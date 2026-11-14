# Tools

Rowbly uses pnpm scripts for development, checks and the build. Biome lints and formats the code and
enforces the strict code style. A script checks that all names are dash-case. tsup bundles the CLI,
and CI runs the same checks on each pull request.

Read this when you change a script, the lint setup, a Biome plugin, the build, Knip or CI. Also read
it when a check fails and you do not know which tool reports it.

## Scripts

```sh
pnpm dev              # run from source: launches the TUI
pnpm dev --help       # run from source with CLI args
pnpm build            # bundle to dist/
pnpm start            # run the built bundle
pnpm typecheck        # tsc --noEmit
pnpm test             # vitest run: run all tests one time; then the node:test suite of scripts/
pnpm test:watch       # vitest: run the tests again when a file changes
pnpm lint             # biome check: lint, formatting and import order; then the dash-case name check
pnpm lint:fix         # biome check --write: apply safe fixes and format
pnpm format           # biome format --write
pnpm knip             # knip: find unused files, exports and dependencies
pnpm knip:production  # knip --production: also find code that only the tests use
pnpm link --global    # put `rowbly` on your PATH for local testing
```

**tsx** runs the source directly during development (`pnpm dev`).

## Biome

`biome.json` sets the lint and format rules.

- The format is double quotes, semicolons, 2-space indent and 120 columns. Do not format by hand. Run
  `pnpm lint:fix`.
- The linter uses the recommended rules, and `useFilenamingConvention` with kebab-case for all script
  files.
- Biome does not examine `.agents/`, `.claude/`, `skills/` or `.rowbly/`.
- The **strict override** applies to `src/**` without the test files. It adds the rules of the strict
  code style and the GritQL plugins in `biome-plugins/`. The
  [`rowbly-code-style` skill](../../.agents/skills/rowbly-code-style/SKILL.md#rules-that-biome-enforces)
  lists each rule and plugin.
- A `biome-ignore` comment must give a specific reason and cover the smallest span. The
  [Exceptions](../../.agents/skills/rowbly-code-style/SKILL.md#exceptions) section of the skill lists
  each exception. Biome reports a suppression that it does not use.

To add a lint rule, follow [../contributing/lint-rules.md](../contributing/lint-rules.md).

## Name check

All files and folders use dash-case names. `scripts/check-names.mjs` checks each path that Git tracks,
also folders, Markdown and HTML. `pnpm lint` runs it after Biome.

The script lists the exceptions:

- Meta files with upper-case names: `README.md`, `AGENTS.md`, `CLAUDE.md`, `SKILL.md`, `LICENSE.md`,
  `UPSTREAM.md` and `CHANGELOG.md`.
- Dotfiles and dotfolders. The name after the dot is dash-case.
- `.agents/skills/agentic-tui/`, because it is an unchanged upstream copy.
- `stages/*.md` and all of `.rowbly/`, because these names are stage keys and Story IDs.

## TypeScript

- `pnpm typecheck` runs `tsc --noEmit`.
- Use `.js` extensions in relative imports (`./tui/index.js`), also for `.ts` and `.tsx` sources. The
  NodeNext ESM resolution makes this necessary.

## Build

`tsup.config.ts` bundles `src/cli.ts` into `dist/cli.js` as ESM for Node 22, with a
`#!/usr/bin/env node` banner. It keeps `@earendil-works/pi-coding-agent` external, so that Pi loads
only on demand. The npm package contains `dist/`, `skills/` (without tests), `stages/` and
`src/config/prompts/`, the system prompts of the factory agents.

## Knip

`knip.json` sets the files that Knip examines. The test helpers (`src/commands/test-cli/`,
`src/services/test-project/` and `src/tui/testing/`) are not production code. `pnpm knip:production`
also finds code that only the tests use.

## Screenshots

Use agentic-tui (`pnpm exec agentic-tui`, a devDependency) for all screenshots of Rowbly. Also use it
to examine each change to the TUI layout in a real terminal.

- Follow the [`rowbly-screenshots` skill](../../.agents/skills/rowbly-screenshots/SKILL.md).
- The full reference for the tool is the [`agentic-tui` skill](../../.agents/skills/agentic-tui/SKILL.md).
  It is an unchanged copy from `@codebolt/agentic-tui` (see its `UPSTREAM.md`).
- Do not draw screens by hand. Do not commit screenshots.

## Agent skills for development

The skills for the development of Rowbly are in `.agents/skills/<name>/SKILL.md`.

| Skill                | Use it for                                                                               |
| -------------------- | ---------------------------------------------------------------------------------------- |
| `rowbly-tui-design`  | All TUI screens, components, modals, forms, lists, colours, borders and key hints        |
| `rowbly-screenshots` | Screenshots and real-terminal checks of the TUI or the CLI                               |
| `rowbly-code-style`  | The TypeScript style: top-level functions, immutable state, layout and files             |
| `agentic-tui`        | The PTY tool. This is an unchanged copy from `@codebolt/agentic-tui` (see `UPSTREAM.md`) |

This repository does not keep installed copies of the bundled skills in `.agents/skills/` or `.claude/`. The bundled skills
are for the users of Rowbly only.

## CI

`.github/workflows/ci.yml` has two jobs:

- **Lint and format**: `biome ci .`, `node scripts/check-names.mjs` and `pnpm typecheck`.
- **Test**: `pnpm test` and `pnpm build`.

`.github/workflows/release.yml` creates a release. Node comes from `.nvmrc`.

## Related

- [testing.md](testing.md): the test suites.
- [../contributing/lint-rules.md](../contributing/lint-rules.md): add a lint rule.
