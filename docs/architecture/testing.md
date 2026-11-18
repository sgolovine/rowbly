# Tests

Rowbly has two test suites. Vitest runs the tests of `src/`. `node:test` runs the tests of
`scripts/`. Each service has a test next to it.

The tests examine only the core functions: the services, the commands, the scripts and the import
boundaries. Do not write tests for the TUI. Do not render a component or a screen in a test, and do
not examine how the TUI looks. Examine the TUI in a real terminal with the
[`rowbly-screenshots` skill](../../.agents/skills/rowbly-screenshots/SKILL.md).

Read this when you write or change a test, or when a test fails and you must know how the suite is
set up.

## Suites

| Command           | Runner      | Tests                                                            |
| ----------------- | ----------- | ---------------------------------------------------------------- |
| `pnpm test`       | Vitest      | `src/**/*.test.ts` and `src/**/*.test.tsx`.                      |
|                   | `node:test` | Then `scripts/*.test.mjs`, for example the dash-case name check. |
| `pnpm test:watch` | Vitest      | The Vitest tests again after each change.                        |

## General rules

- Put the tests in `*.test.ts` files, next to the file that they test.
- Do not put a test in `src/tui/`.
- Test files use only the recommended rules of Biome, not the strict style.
- Keep live credentials out of tests.
- `packages/cli/vitest.config.ts` sets `HOME` to a temporary folder. A test must not write to the real home
  directory.
- `packages/cli/vitest.config.ts` sets `maxWorkers` to 4. Each fork uses approximately 200 MB, and factory workers
  can run the tests at the same time. To change the limit, set `VITEST_MAX_WORKERS` or use
  `--maxWorkers`.
- CI runs `pnpm test`, the same tests that you run on your machine.

## Service tests

Each service has a test. Use `useTestProject()` or `useTempDir()` from `src/services/test-project/`.
They give each test a new Project in a temporary directory. The context of `useTestProject()` also has
a temporary `home`, so that user files such as the model cache do not go from one test to a different
test. Pass the paths through the `ServiceContext`, for example `cwd` and `home`.

## CLI tests

Use `runCli(args, cwd)` from `src/commands/test-cli/`. It runs the program in the process and gives
the exit code, stdout and stderr. `createProgram()` builds the program without a run.

## Native factory tests

- Native session tests use the faux provider of Pi and in-memory credentials. They make no live
  provider requests.
- Daemon tests use private HOME and Pi agent directories, temporary Git Projects and a loader that
  blocks network access.
- Do not add a production faux-provider flag.
- Scripted authentication tests do not prove real OAuth login, provider entitlement or token refresh.
- Live provider validation is separate from the automated checks.
- The `import-boundary` test makes sure that help and `factory status` do not load Pi. See
  [native-factory/pi-runtime-and-auth.md](native-factory/pi-runtime-and-auth.md).
- `import-boundary` also makes sure that an import of the TUI does not load Pi.
- The TUI import boundary test `src/cli.test.ts` makes sure that help, `story get` and `status` do
  not load Ink or React. It also makes sure that `src/cli.ts` has no static import of Ink, React or
  `src/tui/`.
- Check queue tests give fake `CheckQueueDeps`: fake memory and process readers, a fake spawn, fake
  signals and short times. Only the tests of `proc-readers.ts` and of the orphan recovery start real
  short processes. See [native-factory/checks.md](native-factory/checks.md#the-queue).

## Related

- [tooling.md](tooling.md): the scripts and CI.
- [`rowbly-screenshots` skill](../../.agents/skills/rowbly-screenshots/SKILL.md): checks of the TUI in
  a real terminal.
