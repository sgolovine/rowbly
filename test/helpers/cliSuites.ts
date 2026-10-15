import { globSync, readFileSync } from 'node:fs';

/** Every test file. */
export const TEST_FILES = ['test/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'];

/**
 * The suites that run a built CLI: those that mention `runCli` or a CLI path. Only these need
 * globalSetup.ts, so every other suite runs without building anything.
 */
export function cliSuites(): string[] {
  return TEST_FILES.flatMap((pattern) => globSync(pattern)).filter((file) =>
    /\b(runCli|CLI_PATH|FIXTURE_CLI_PATH)\b/.test(readFileSync(file, 'utf8')),
  );
}
