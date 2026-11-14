# Tests

Rowbly has two test suites. Vitest runs the tests of `src/`. `node:test` runs the tests of
`scripts/`. Each service and each component has a test next to it.

Read this when you write or change a test, or when a test fails and you must know how the suite is
set up.

## Suites

| Command           | Runner      | Tests                                                            |
| ----------------- | ----------- | ---------------------------------------------------------------- |
| `pnpm test`       | Vitest      | `src/**/*.test.ts` and `src/**/*.test.tsx`.                      |
|                   | `node:test` | Then `scripts/*.test.mjs`, for example the dash-case name check. |
| `pnpm test:watch` | Vitest      | The Vitest tests again after each change.                        |

## General rules

- Put the tests in `*.test.ts` and `*.test.tsx` files, next to the file that they test.
- A component test is in the folder of its component.
- Test files use only the recommended rules of Biome, not the strict style.
- Keep live credentials out of tests.
- `vitest.config.ts` sets `HOME` to a temporary folder. A test that renders the shell records its
  Project, and it must not write to the real home directory.

## Service tests

Each service has a test. Use `useTestProject()` or `useTempDir()` from `src/services/test-project/`.
They give each test a new Project in a temporary directory. Pass the paths through the
`ServiceContext`, for example `cwd` and `home`.

## CLI tests

Use `runCli(args, cwd)` from `src/commands/test-cli/`. It runs the program in the process and gives
the exit code, stdout and stderr. `createProgram()` builds the program without a run.

## Component tests

- **Each component has a test.** When you add a component, add `<name>.test.tsx` in the same folder.
  When you change a component, update its test.
- **Render through `renderTui`.** `renderTui` from `src/tui/testing/` renders a component in
  `TuiProviders`, through ink-testing-library.
  - Use `press` and `keys` to send keys.
  - Use `click` and `mouse` to send mouse events.
  - Use `frame` to read the screen without colours.
- **Test the behaviour.** Examine the text, the keys and the mouse actions. Do not examine the
  colours.
- Call `cleanup` from ink-testing-library in `afterEach`.

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

## Related

- [tooling.md](tooling.md): the scripts and CI.
- [`rowbly-screenshots` skill](../../.agents/skills/rowbly-screenshots/SKILL.md): checks of the TUI in
  a real terminal.
