import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    /** The CLI this run built, for `runCli`; only the `cli` project has it. */
    cliBuilds: { cli: string };
  }
}

/**
 * Builds the CLI from the current source, before the CLI suites run. Each run builds into a folder
 * of its own under `.test-dist/`, so runs in parallel never clean each other's CLI, and removes only
 * that folder afterwards. The folder is inside the repository so the bundle resolves its
 * dependencies from `node_modules`.
 */
export default function setup(project: TestProject): () => void {
  const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
  const parent = join(repoRoot, '.test-dist');
  mkdirSync(parent, { recursive: true });
  const outDir = mkdtempSync(join(parent, 'run-'));
  const tsup = 'node_modules/tsup/dist/cli-default.js';
  try {
    execFileSync(process.execPath, [tsup, '--out-dir', join(outDir, 'main'), '--silent'], {
      cwd: repoRoot,
      stdio: 'inherit',
    });
  } catch (err) {
    rmSync(outDir, { recursive: true, force: true });
    throw err;
  }
  project.provide('cliBuilds', { cli: join(outDir, 'main/cli.js') });
  return () => rmSync(outDir, { recursive: true, force: true });
}
