import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    // Builds dist/cli.js once so command tests can run it through runCli().
    globalSetup: ['test/helpers/globalSetup.ts'],
    // Command tests spawn the built CLI; give them room on a loaded machine.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
