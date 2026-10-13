# WP00 — Scaffold & Contracts

**Depends on:** — · **Phase:** 0 · **Unblocks:** everything

## Goal

Create the repository skeleton and turn the frozen contracts into code, so that later packages can work in parallel without editing the same files.

## Owns

Everything at the repo root (`package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `tsup.config.ts`, `biome.json`, `vitest.config.ts`, `.gitignore`, `README.md`), `src/cli.ts`, `src/core/**`, `src/schemas/**`, `src/services/**` (stubs + `types.ts` + `index.ts`), `src/storage/index.ts` (interface stubs only), `src/output/**`, `src/commands/**` (stubs), `src/tui/**` (stubs only, so WP02 can fill them), `test/helpers/**`.

## Deliverables

1. **Toolchain.**
   - Node 22, `"type": "module"`, and pnpm scripts `build` (tsup → `dist/cli.js` with a shebang), `dev`, `typecheck`, `lint` (`biome check`), `format`, `test` (`vitest run`) and `test:watch`.
   - The `bin` entry is `rowbly`.
   - `tsconfig` is strict, with `noUncheckedIndexedAccess` and JSX set to `react-jsx`.
   - Install all of the README §2 dependencies now, so later packages don't need to touch the lockfile.
2. **`src/core/`.**
   - `errors.ts`: the classes from contracts §6, with `code` and `exitCode`.
   - `ids.ts`: regexes for slug, key prefix, Story Key, Task id and label, plus parsers (`parseStoryKey('web-42') → {prefix:'WEB', n:42}`, `parseTaskId`).
   - `rank.ts`: wraps `fractional-indexing`.
   - `time.ts`: timestamp and IsoDate helpers.
3. **`src/schemas/`.** zod schemas and inferred types for everything in contracts §2, plus `DEFAULT_STAGES`. Each schema has a unit test with valid and invalid fixtures.
4. **`src/services/types.ts`.** The full contracts §8 interfaces, including every input/patch/filter type, `InitOptions`, `InitResult` and `DoctorReport`.
   - `src/services/<area>.ts`: one stub per area that throws `not implemented: WPxx`.
   - `createServices(ctx)` in `src/services/index.ts`.
5. **`src/storage/index.ts`.** The exported function and repository signatures from contracts §9, as stubs. WP01 implements them.
6. **`src/output/`.**
   - `render.ts`: `printResult(data, { json, human: (data) => string })`, `printError(err, { json })`, `printWarnings`.
   - `table.ts`: cli-table3 wrapper.
   - `colors.ts`: picocolors.
   - Stage categories get consistent colours: todo dim, in_progress yellow, done green.
7. **`src/cli.ts` + `src/commands/`.**
   - A commander program with the global flags (contracts §5).
   - Dispatch: no args and a TTY start the TUI (`src/tui/index.ts` `startTui()`); no args without a TTY prints help and exits 2. Everything else runs commander.
   - A top-level error handler maps `RowblyError` to an exit code and output.
   - Shared helpers in `src/commands/_shared.ts`:
     - `withContext()`, which resolves the Data Root, Local State and Me and builds `RowblyContext`;
     - `promptIfMissing()` (Clack, gated as in contracts §5);
     - `confirmDestructive()`;
     - `readLongText()`, for `--description`/`--description-file`/`--edit` and `$EDITOR`;
     - `parseRepeatable()`;
     - `parseFieldAssignments()`.
   - `src/commands/index.ts` registers one stub module per area: `setup` (init, use, whoami, config), `workspaces`, `assignees`, `boards`, `stages`, `fields`, `stories`, `tasks`, `comments`, `epics`, `doctor`. Each stub declares its noun with a description, and its verbs print "not implemented".
8. **`src/tui/` stubs.**
   - `index.ts`: `startTui()`, which renders a placeholder.
   - `screens/index.ts`: a registry with one entry per area pointing at a placeholder component.
   - Placeholder files that WP02, WP05 and WP06 will replace:
     - `screens/tasks/StoryTasksTab.tsx`
     - `screens/comments/CommentsPanel.tsx`
9. **`test/helpers/`.**
   - `tempRoot()`: creates a temp `.rowbly/` and cleans it up.
   - `fixedClock()`.
   - `fixedIds()`.
   - `runCli(args, { root, env, stdin })`: runs the built `dist/cli.js` in a child process and returns `{ stdout, stderr, exitCode }`.
   - `fixtures.ts`: builders that write valid files directly (`makeWorkspace`, `makeBoard`, `makeStory`, `makeEpic`).
10. **`README.md`.** Install, dev and test instructions, plus the empty marker sections `<!-- BEGIN <area> --> … <!-- END <area> -->` for: setup, workspaces, assignees, boards, stages, fields, stories, tasks, comments, epics, doctor and tui.

## Acceptance criteria

- [ ] `pnpm install && pnpm typecheck && pnpm lint && pnpm test && pnpm build` passes on a clean clone.
- [ ] `node dist/cli.js --help` lists all 11 command groups. `node dist/cli.js stories list` exits 1 with a not-implemented message, and the cause is the stub, not a crash in dispatch.
- [ ] Every schema has passing and failing fixture tests. One test checks that serializing a parsed value produces keys in schema order.
- [ ] `parseStoryKey` accepts `web-42` and rejects `WEB-0`, `WEB42` and `1WEB-2`.
- [ ] `printError` produces the exact JSON error shape from contracts §6.
- [ ] `runCli` works in a test that runs `--version`.
- [ ] No `node:fs` import exists outside `src/storage/` and `test/`. A Biome rule or a unit test enforces this.
