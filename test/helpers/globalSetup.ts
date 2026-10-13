import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Builds dist/cli.js once before the suite, so runCli() always exercises the current source, and
 * the fixture CLI (the same program with the fixture Plugins as its registry) into .test-dist/.
 */
export default function setup(): void {
  const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
  const tsup = 'node_modules/tsup/dist/cli-default.js';
  execFileSync(process.execPath, [tsup, '--silent'], { cwd: repoRoot, stdio: 'inherit' });
  execFileSync(
    process.execPath,
    [
      tsup,
      'test/plugins/fixtures/cli.ts',
      '--no-config',
      '--format',
      'esm',
      '--platform',
      'node',
      '--target',
      'node22',
      '--out-dir',
      '.test-dist',
      '--silent',
    ],
    { cwd: repoRoot, stdio: 'inherit' },
  );
}
