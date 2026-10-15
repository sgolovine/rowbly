// Helpers for the storage commit engine tests: subprocess runs, tree snapshots and fault injection
// through the `io` seam (no chmod, so the tests also work as root).
import { spawn } from 'node:child_process';
import { lstat, readdir, readFile, readlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { vi } from 'vitest';
import { io } from '../../src/storage/io';

const REPO = fileURLToPath(new URL('../..', import.meta.url));

/** The path of a script in `test/storage/fixtures/`. */
export function fixtureScript(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
}

export interface ScriptResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

/**
 * Runs a TypeScript script in one Node process with tsx's loader, so a signal that kills the script
 * shows as the child's signal. With `shell`, it runs as `bash -c "<shell> exec node …"` so a prefix
 * such as `ulimit -f 2;` applies to it.
 */
export function runScript(script: string, args: string[], options: { shell?: string } = {}): Promise<ScriptResult> {
  const argv = ['--import', 'tsx', script, ...args];
  const child = options.shell
    ? spawn('bash', ['-c', `${options.shell} exec "$0" "$@"`, process.execPath, ...argv], { cwd: REPO })
    : spawn(process.execPath, argv, { cwd: REPO });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

/**
 * Every entry under `dir` (skipping `skip` names at the top), as a sorted map of `/`-separated
 * relative path → file text, `<dir>` or `-> <link target>`.
 */
export async function snapshotTree(dir: string, skip: readonly string[] = ['.txn']): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  async function walk(rel: string): Promise<void> {
    const names = (await readdir(join(dir, rel))).sort();
    for (const name of names) {
      if (rel === '' && skip.includes(name)) continue;
      const childRel = rel ? `${rel}/${name}` : name;
      const path = join(dir, childRel);
      const info = await lstat(path);
      if (info.isSymbolicLink()) out[childRel] = `-> ${await readlink(path)}`;
      else if (info.isDirectory()) {
        out[childRel] = '<dir>';
        await walk(childRel);
      } else out[childRel] = await readFile(path, 'utf8');
    }
  }
  await walk('');
  return out;
}

/** The `io` methods that change the filesystem. */
export const MUTATING = ['writeFile', 'rename', 'mkdir', 'unlink', 'rmdir', 'rm', 'syncDir'] as const;
type Mutating = (typeof MUTATING)[number];

export interface Faults {
  /** How many mutating calls have been made so far. */
  readonly calls: number;
  /** The mutating calls made so far, as `method path`. */
  readonly log: readonly string[];
  /** Makes the `n`-th mutating call (1-based) and every later one throw, like a dead process. */
  crashAt(n: number): void;
  /** Makes only the `n`-th mutating call throw. */
  failOnce(n: number, error?: Error): void;
  restore(): void;
}

/** Spies on every mutating `io` method, counting calls and injecting failures. */
export function injectFaults(): Faults {
  let calls = 0;
  let crashFrom = Number.POSITIVE_INFINITY;
  let failAt = -1;
  let failError: Error | undefined;
  const log: string[] = [];
  const spies = MUTATING.map((name: Mutating) => {
    const original = io[name] as (...args: unknown[]) => Promise<unknown>;
    return vi.spyOn(io, name).mockImplementation(((...args: unknown[]) => {
      calls += 1;
      log.push(`${name} ${String(args[0])}`);
      if (calls >= crashFrom)
        return Promise.reject(Object.assign(new Error(`injected crash at ${name}`), { code: 'EIO' }));
      if (calls === failAt)
        return Promise.reject(failError ?? Object.assign(new Error(`injected ${name} failure`), { code: 'EIO' }));
      return original(...args);
    }) as never);
  });
  return {
    get calls() {
      return calls;
    },
    log,
    crashAt(n) {
      crashFrom = n;
    },
    failOnce(n, error) {
      failAt = n;
      failError = error;
    },
    restore() {
      for (const spy of spies) spy.mockRestore();
    },
  };
}
