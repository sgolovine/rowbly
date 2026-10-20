// biome-ignore lint/style/noRestrictedImports: the test configuration reads test files, not a Data Root.
import { globSync, readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const include = ['test/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'];

/**
 * The suites that run a built CLI: those that mention `runCli` or `CLI_PATH`. Only these need
 * test/helpers/globalSetup.ts, so every other suite runs without building anything.
 */
const cliSuites = include
  .flatMap((pattern) => globSync(pattern))
  .filter((file) => /\b(runCli|CLI_PATH)\b/.test(readFileSync(file, 'utf8')));

export default defineConfig({
  test: {
    // Frame assertions and snapshots use plain text, regardless of terminal or CI color support.
    env: { NO_COLOR: '1', FORCE_COLOR: '0' },
    // Room for async TUI and file-heavy tests on a loaded machine.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // `pnpm test` runs both projects; `pnpm test:unit` runs every suite that needs no CLI build.
    projects: [
      { extends: true, test: { name: 'unit', include, exclude: cliSuites } },
      {
        extends: true,
        // Builds both CLIs from the current source, once per run, into a folder of the run's own.
        test: {
          name: 'cli',
          include: cliSuites,
          globalSetup: ['test/helpers/globalSetup.ts'],
          // A command test spawns the built CLI many times in a row (the Plugins skill check takes
          // ~7 s on an idle machine); give it room on a loaded machine. A limit, not a budget.
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
