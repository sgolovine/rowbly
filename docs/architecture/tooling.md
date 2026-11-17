# Tools

Rowbly uses pnpm scripts for development, checks and the build. Biome lints and formats the code and
enforces the strict code style. A script checks that all names are dash-case. tsup bundles the CLI,
and CI runs the same checks on each pull request.

Read this when you change a script, the lint setup, a Biome plugin, the build, Knip, CI or the
workspace. Also read it when a check fails and you do not know which tool reports it.

## Workspace

The repository is a pnpm workspace. `pnpm-workspace.yaml` lists the packages in `packages/*`:

- `packages/cli/` is the `rowbly` package. Its `package.json` has the version, the `bin` and the
  `files` of the npm package.
- `packages/website/` is the `rowbly-website` package. It is private. See its `README.md`.

The root `package.json` is private. It has the shared tools (Biome, Knip, agentic-tui and tsx) and
the scripts below. The root has the only `pnpm-lock.yaml`. `pnpm-workspace.yaml` also has the
settings of pnpm, for example `minimumReleaseAge` and the `node-pty` override.

Run all `pnpm` commands from the root of the repository. To add a dependency to one package, use a
filter:

```sh
pnpm --filter rowbly add <name>
pnpm --filter rowbly-website add <name>
```

## Scripts

```sh
pnpm dev               # run from source: launches the TUI
pnpm dev --help        # run from source with CLI args
pnpm build             # bundle to packages/cli/dist/
pnpm start             # run the built bundle
pnpm typecheck         # tsc --noEmit in packages/cli/
pnpm test              # vitest run in packages/cli/: run all tests one time; then the node:test suite of scripts/
pnpm test:watch        # vitest: run the tests again when a file changes
pnpm lint              # biome check: lint, formatting and import order; then the dash-case name check
pnpm lint:fix          # biome check --write: apply safe fixes and format
pnpm format            # biome format --write
pnpm knip              # knip: find unused files, exports and dependencies
pnpm knip:production   # knip --production: also find code that only the tests use
pnpm website:dev       # run the development server of the website
pnpm website:build     # build the website to packages/website/dist/
pnpm website:typecheck # tsc --noEmit in packages/website/
# put `rowbly` on your PATH for local testing
pnpm --dir packages/cli link --global
```

**tsx** runs the source directly during development (`pnpm dev`). The working directory of `pnpm dev`
stays the root of the repository, so `pnpm dev` uses the Rowbly Project of this repository.

## Biome

`biome.jsonc` sets the lint and format rules.

- The format is double quotes, semicolons, 2-space indent and 120 columns. Do not format by hand. Run
  `pnpm lint:fix`.
- The linter uses the recommended rules, and `useFilenamingConvention` with kebab-case for all script
  files. An override sets `useFilenamingConvention` to off in `packages/website/src/routes/**`, because TanStack
  Router route names are not kebab-case. The [name check](#name-check) examines these names.
- `biome.jsonc` is JSONC, so it can have comments. Write a comment that tells why for each override that
  is not clear.
- Biome does not examine `.agents/`, `.claude/`, `skills/` or `.rowbly/`.
- The **strict override** applies to `packages/cli/src/**` without the test files. It adds the rules of the strict
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
- `packages/cli/stages/*.md` and all of `.rowbly/`, because these names are stage keys and Story IDs.
- `packages/cli/src/config/prompts/*.md`, because these names are the names of the user prompts.
- The TanStack Router file-based routes in `packages/website/src/routes/`. `isGoodRouteSegment` examines each
  file and folder below this folder. Each word in a name must be dash-case. The script accepts these
  forms:

  | Form                     | Example                  | Meaning                                  |
  | ------------------------ | ------------------------ | ---------------------------------------- |
  | `__root`                 | `__root.tsx`             | The root route                           |
  | `$name`                  | `$story-key.tsx`         | A path parameter                         |
  | `{-$name}`               | `{-$locale}/`            | An optional path parameter               |
  | `$`                      | `$.tsx`                  | A splat (catch-all) route                |
  | `_name`                  | `_marketing.tsx`         | A pathless layout route                  |
  | `name_`                  | `posts_.tsx`             | A non-nested route                       |
  | `-name`                  | `-components/`           | A file or folder that the router ignores |
  | `(name)`                 | `(legal)/`               | A route group folder                     |
  | `a.b.c`                  | `how-it-works.index.tsx` | Flat routes: a dot separates two parts   |
  | `[x]`                    | `script[.]js.tsx`        | An escaped character                     |
  | `index`, `route`, `lazy` | `index.lazy.tsx`         | Special route file names                 |

  Outside `packages/website/src/routes/`, these forms are errors. For example, `$storyKey.tsx`, `__Root.tsx` and
  `My_Page.tsx` are errors in all folders.
- The generated route tree of TanStack Router must have a dash-case name. Set
  `generatedRouteTree: "./src/route-tree.gen.ts"` in the router config.

## TypeScript

- `pnpm typecheck` runs `tsc --noEmit` in `packages/cli/`. `pnpm website:typecheck` does the same for
  the website.
- Use `.js` extensions in relative imports (`./tui/index.js`), also for `.ts` and `.tsx` sources. The
  NodeNext ESM resolution makes this necessary.

## Build

`packages/cli/tsup.config.ts` bundles `src/cli.ts` into `dist/cli.js` as ESM for Node 22, with a
`#!/usr/bin/env node` banner. A second entry bundles `src/services/pi-runtime/pi-worker.ts` into
`dist/pi-worker.js`, the [Pi worker](native-factory/pi-runtime-and-auth.md#the-pi-worker). The
shared chunks are also in `dist/`, so the worker client finds `pi-worker.js` next to its chunk. It keeps `@earendil-works/pi-coding-agent` external, so that Pi loads
only on demand. The npm package contains `dist/`, `skills/` (without tests), `stages/` and
`src/config/prompts/`, the system prompts of the factory agents.

The TUI is in a separate chunk, `dist/tui-<hash>.js`. `src/cli-main.ts` loads `./tui/index.js` with a
dynamic `import()` only when `rowbly` starts without arguments. tsup splits each dynamic `import()`
into its own chunk by default, so `tsup.config.ts` has no chunk settings. Thus `dist/cli.js` and
its CLI chunk have no static import of Ink or React, and CLI commands and the factory daemon do not
load the TUI.
`src/cli.test.ts` and `src/commands/tui-boundary.test.ts` make sure that the code obeys this rule.

## Compile cache

Rowbly turns on the Node compile cache as the first action of each process. Then the next start of
the CLI, the TUI or the factory daemon compiles less JavaScript.

- `src/cli.ts` is a small bootstrap entry. It calls `enableRowblyCompileCache()` from
  `src/services/compile-cache/`. Then it loads `src/cli-main.ts` with a dynamic `import()`.
- Node compiles all static imports before the code of a module runs. Thus `src/cli.ts` can only have
  static imports of `node:` built-ins and of the compile cache module.
- The cache directory is `<user cache dir>/rowbly/compile-cache`. The user cache directory is:
  - `$XDG_CACHE_HOME`, if it is an absolute path.
  - Otherwise, `~/Library/Caches` on macOS.
  - Otherwise, `%LOCALAPPDATA%` on Windows, if it is set.
  - Otherwise, `~/.cache`.
- If `NODE_COMPILE_CACHE` is set, Rowbly does not give its own directory. Node uses the directory of
  the variable.
- If `NODE_DISABLE_COMPILE_CACHE` is set, Rowbly does not turn on the cache.
- A failure is silent. The function does not throw and does not write to stdout or stderr. Rowbly
  operates the same without the cache.
- The factory daemon starts from the same entry, so it also gets the cache.
- A `worker_threads` worker does not get the cache of the main thread. Thus the Pi worker
  (`src/services/pi-runtime/pi-worker.ts`) calls `enableRowblyCompileCache()` in the worker thread
  before it imports Pi. The worker uses the same directory and the same rules. See
  [native-factory/pi-runtime-and-auth.md](native-factory/pi-runtime-and-auth.md#the-pi-worker).

## Knip

`knip.json` sets the files that Knip examines in each workspace. Knip examines the root and
`packages/cli/`. It does not examine `packages/website/`. The test helpers (`src/commands/test-cli/` and
`src/services/test-project/`) are not production code. `pnpm knip:production`
also finds code that only the tests use.

## Screenshots

Use agentic-tui (`pnpm exec agentic-tui`, a devDependency) for all screenshots of Rowbly. Also use it
to examine each change to the TUI layout in a real terminal.

- Follow the [`rowbly-screenshots` skill](../../.agents/skills/rowbly-screenshots/SKILL.md).
- The full reference for the tool is the [`agentic-tui` skill](../../.agents/skills/agentic-tui/SKILL.md).
  It is an unchanged copy from `@codebolt/agentic-tui` (see its `UPSTREAM.md`).
- Do not draw screens by hand. Do not commit screenshots. The only exception is the website images in
  `packages/website/public/screenshots/`. Its `README.md` gives the alt text of each image.

## Agent skills for development

The skills for the development of Rowbly are in `.agents/skills/<name>/SKILL.md`.

| Skill                | Use it for                                                                               |
| -------------------- | ---------------------------------------------------------------------------------------- |
| `rowbly-tui-design`  | All TUI screens, components, modals, forms, lists, colours, borders and key hints        |
| `rowbly-screenshots` | Screenshots and real-terminal checks of the TUI or the CLI                               |
| `rowbly-code-style`  | The TypeScript style: top-level functions, immutable state, layout and files             |
| `agentic-tui`        | The PTY tool. This is an unchanged copy from `@codebolt/agentic-tui` (see `UPSTREAM.md`) |

The `refine`, `develop` and `review` folders in `.agents/skills/` are installed copies of the bundled skills. The Rowbly
project of this repository uses them through its Stage prompts in `.rowbly/stages/`. Rowbly code does not read them.

The `changelog` folder in `.agents/skills/` is a skill of this repository only. It is not a bundled skill. The
`CHANGELOG` Stage uses it to add one entry for each Story to `CHANGELOG.md`.

## CI

`.github/workflows/ci.yml` has two jobs:

- **Lint and format**: `biome ci .`, `node scripts/check-names.mjs` and `pnpm typecheck`.
- **Test**: `pnpm test` and `pnpm build`.

`.github/workflows/website.yml` builds the website and deploys it to GitHub Pages. It runs when a change
is in `packages/website/`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` or the workflow file.

`.github/workflows/release.yml` creates a release. Node comes from `.nvmrc`.

- `scripts/release-changelog.mjs` changes the `### Pre Release` heading of `CHANGELOG.md` to the new version,
  for example `### 1.12.0`. Then it adds a new empty `### Pre Release` section above it.
- The workflow changes the version in `packages/cli/package.json` and publishes the package from
  `packages/cli/`. The `prepack` script of the package copies `README.md` and `LICENSE.md` from the root
  into the package. The `postpack` script removes the copies.
- The release commit holds `packages/cli/package.json` and `CHANGELOG.md`. If a later step fails, the `revert-version` job
  reverts that commit, and the changelog also goes back.
- The script stops the release if `CHANGELOG.md` does not have exactly one `### Pre Release` heading.

## Related

- [testing.md](testing.md): the test suites.
- [../contributing/lint-rules.md](../contributing/lint-rules.md): add a lint rule.
