// biome-ignore lint/style/noRestrictedImports: the test configuration reads test files, not a Data Root.
import { globSync, readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const include = ['test/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'];

/**
 * The suites that run a built CLI: those that mention `runCli` or a CLI path. Only these need
 * test/helpers/globalSetup.ts, so every other suite runs without building anything.
 */
const cliSuites = include
  .flatMap((pattern) => globSync(pattern))
  .filter((file) => /\b(runCli|CLI_PATH|FIXTURE_CLI_PATH)\b/.test(readFileSync(file, 'utf8')));

export default defineConfig({
  test: {
    // Command tests spawn the built CLI; give them room on a loaded machine.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // `pnpm test` runs both projects; `pnpm test:unit` runs every suite that needs no CLI build.
    projects: [
      { extends: true, test: { name: 'unit', include, exclude: cliSuites } },
      {
        extends: true,
        // Builds both CLIs from the current source, once per run, into a folder of the run's own.
        test: { name: 'cli', include: cliSuites, globalSetup: ['test/helpers/globalSetup.ts'] },
      },
    ],
  },
});
