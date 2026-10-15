import { defineConfig } from 'vitest/config';
import { cliSuites, TEST_FILES } from './test/helpers/cliSuites';

const cli = cliSuites();

export default defineConfig({
  test: {
    // Command tests spawn the built CLI; give them room on a loaded machine.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // `pnpm test` runs both projects; `pnpm test:unit` runs every suite that needs no CLI build.
    projects: [
      { extends: true, test: { name: 'unit', include: TEST_FILES, exclude: cli } },
      {
        extends: true,
        // Builds both CLIs from the current source, once per run, into a folder of the run's own.
        test: { name: 'cli', include: cli, globalSetup: ['test/helpers/globalSetup.ts'] },
      },
    ],
  },
});
