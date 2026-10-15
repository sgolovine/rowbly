import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    /** The CLIs this run built, for `runCli`; only the `cli` project has them. */
    cliBuilds: { cli: string; fixtureCli: string };
  }
}

/**
 * Builds the CLI and the fixture CLI (the same program with the fixture Plugins of
 * test/plugins/fixtures as its registry) from the current source, before the CLI suites run. Each
 * run builds into a folder of its own under `.test-dist/`, so runs in parallel never clean each
 * other's CLIs, and removes only that folder afterwards. The folder is inside the repository so the
 * bundles resolve their dependencies from `node_modules`.
 */
export default function setup(project: TestProject): () => void {
  const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
  const parent = join(repoRoot, '.test-dist');
  mkdirSync(parent, { recursive: true });
  const outDir = mkdtempSync(join(parent, 'run-'));
  const tsup = 'node_modules/tsup/dist/cli-default.js';
  const build = (args: string[]) =>
    execFileSync(process.execPath, [tsup, ...args, '--silent'], { cwd: repoRoot, stdio: 'inherit' });
  try {
    build(['--out-dir', join(outDir, 'main')]);
    build([
      'test/plugins/fixtures/cli.ts',
      '--no-config',
      '--format',
      'esm',
      '--platform',
      'node',
      '--target',
      'node22',
      '--out-dir',
      join(outDir, 'fixture'),
    ]);
  } catch (err) {
    rmSync(outDir, { recursive: true, force: true });
    throw err;
  }
  project.provide('cliBuilds', { cli: join(outDir, 'main/cli.js'), fixtureCli: join(outDir, 'fixture/cli.js') });
  return () => rmSync(outDir, { recursive: true, force: true });
}
