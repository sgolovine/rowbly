import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    // Builds dist/cli.js once so command tests can run it through runCli().
    globalSetup: ['test/helpers/globalSetup.ts'],
    testTimeout: 20_000,
  },
});
