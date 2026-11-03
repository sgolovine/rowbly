// Runs one Rowbly command as a child process of this CLI, for a Plugin command that applies other
// commands (ADR-0045 §3). No shell is involved: argv goes to the child as it is.
import { spawn } from 'node:child_process';
import { UsageError } from '../core';

/** Set in the child's environment, so a child cannot run children of its own. */
const CHILD_ENV = 'ROWBLY_CHILD_COMMAND';
const MAX_OUTPUT = 4 * 1024 * 1024;

/** Global and interactive options the host pins itself; a caller may not give them. */
const PINNED = new Set(['--data-root', '--json', '--yes', '--prompt', '--no-prompt', '--version', '--help']);

export interface ChildCommandResult {
  /** The child's exit code; a child ended by a signal counts as 1. */
  exitCode: number;
  /** The child's JSON output: its result on success, its error object on failure; `null` when it printed none. */
  output: unknown;
}

function parseJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

/** The `{"error":…}` line among stderr's `{"warning":…}` lines, else stderr as text. */
function parseError(text: string): unknown {
  const lines = text.trim().split('\n').reverse();
  for (const line of lines) {
    const parsed = parseJson(line);
    if (parsed && typeof parsed === 'object' && 'error' in parsed) return parsed;
  }
  return text.trim() || null;
}

/**
 * Runs `rowbly <argv> --data-root <root> --json --no-prompt` with the same Node.js, loader flags and
 * entry point as this process, waits for it and returns its exit code and JSON output. Each child
 * opens and locks the Data Root for its own operation, so the caller must not hold the lock.
 */
export async function runChildCommand(root: string, argv: readonly string[]): Promise<ChildCommandResult> {
  if (process.env[CHILD_ENV]) throw new UsageError('A command run by another Rowbly command cannot run commands');
  if (!argv.length) throw new UsageError('No command to run');
  for (const arg of argv) {
    if (arg.includes('\0')) throw new UsageError('A command argument cannot contain a NUL character');
    const name = arg.split('=')[0] as string;
    if (PINNED.has(name) || (arg.startsWith('-') && !arg.startsWith('--')) || arg === '--')
      throw new UsageError(`Option "${arg}" is set by Rowbly, not by the command it runs`);
  }
  const entry = process.argv[1];
  if (!entry) throw new UsageError('Cannot find the Rowbly entry point to run a command');
  const args = [...process.execArgv, entry, ...argv, '--data-root', root, '--json', '--no-prompt'];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, [CHILD_ENV]: '1' },
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let size = 0;
    const collect = (into: Buffer[]) => (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_OUTPUT) child.kill();
      else into.push(chunk);
    };
    child.stdout.on('data', collect(out));
    child.stderr.on('data', collect(err));
    child.on('error', reject);
    child.on('close', (code) => {
      const exitCode = code ?? 1;
      const text = Buffer.concat(exitCode === 0 ? out : err).toString('utf8');
      resolve({ exitCode, output: exitCode === 0 ? parseJson(text) : parseError(text) });
    });
  });
}
